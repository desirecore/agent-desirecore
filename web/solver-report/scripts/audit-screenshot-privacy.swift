#!/usr/bin/env swift
import AppKit
import Foundation
import Vision

enum AuditError: Error, CustomStringConvertible {
  case usage
  case malformedPlan(String)
  case unsafePath(String)
  case unreadableImage(String)

  var description: String {
    switch self {
    case .usage:
      return "usage: audit-screenshot-privacy.swift <input-root> <screenshot-plan.json> <ocr-output.json>"
    case .malformedPlan(let detail):
      return "malformed screenshot plan: \(detail)"
    case .unsafePath(let path):
      return "screenshot path escapes input root: \(path)"
    case .unreadableImage(let path):
      return "cannot decode screenshot: \(path)"
    }
  }
}

func requiredString(_ object: [String: Any], _ key: String) throws -> String {
  guard let value = object[key] as? String, !value.isEmpty else {
    throw AuditError.malformedPlan("missing \(key)")
  }
  return value
}

do {
  guard CommandLine.arguments.count == 4 else { throw AuditError.usage }
  let inputRoot = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
  let planURL = URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL
  let outputURL = URL(fileURLWithPath: CommandLine.arguments[3]).standardizedFileURL
  let planData = try Data(contentsOf: planURL)
  guard
    let plan = try JSONSerialization.jsonObject(with: planData) as? [String: Any],
    let scenarios = plan["scenarios"] as? [[String: Any]]
  else {
    throw AuditError.malformedPlan("scenarios must be an array")
  }

  var entries: [[String: Any]] = []
  for scenario in scenarios {
    let scenarioId = try requiredString(scenario, "scenarioId")
    guard let screenshots = scenario["screenshots"] as? [[String: Any]] else {
      throw AuditError.malformedPlan("\(scenarioId).screenshots must be an array")
    }
    for screenshot in screenshots {
      let relativePath = try requiredString(screenshot, "file")
      let imageURL = inputRoot.appendingPathComponent(relativePath).standardizedFileURL
      let rootPrefix = inputRoot.path.hasSuffix("/") ? inputRoot.path : inputRoot.path + "/"
      guard imageURL.path.hasPrefix(rootPrefix) else { throw AuditError.unsafePath(relativePath) }

      let recognizedLines: [[String: Any]] = try autoreleasepool {
        guard
          let image = NSImage(contentsOf: imageURL),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else {
          throw AuditError.unreadableImage(relativePath)
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        return (request.results ?? []).compactMap { observation in
          guard let text = observation.topCandidates(1).first?.string else { return nil }
          let box = observation.boundingBox
          return [
            "text": text,
            "boundingBox": [box.origin.x, box.origin.y, box.size.width, box.size.height],
          ]
        }
      }
      entries.append([
        "scenarioId": scenarioId,
        "file": relativePath,
        "lines": recognizedLines,
      ])
      FileHandle.standardError.write(Data("OCR \(entries.count): \(relativePath)\n".utf8))
    }
  }

  let output: [String: Any] = [
    "schemaVersion": "solver.screenshot-privacy-ocr/v1",
    "generatedAt": ISO8601DateFormatter().string(from: Date()),
    "engine": "Apple Vision VNRecognizeTextRequest accurate zh-Hans+en-US",
    "entries": entries,
  ]
  let outputData = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
  try outputData.write(to: outputURL, options: .atomic)
} catch {
  FileHandle.standardError.write(Data("\(error)\n".utf8))
  exit(1)
}
