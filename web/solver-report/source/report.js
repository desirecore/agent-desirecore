;(() => {
  'use strict'
  const manifest = window.__REPORT_MANIFEST__
  if (!manifest) throw new Error('report manifest missing')
  window.__REPORT_CHAPTERS__ = window.__REPORT_CHAPTERS__ || {}

  const $ = (selector) => document.querySelector(selector)
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    )
  const statusTone = (status) =>
    ['infeasible', 'fail', 'blocked_engine_unavailable'].includes(status) ? 'guard' : 'pass'
  const statusLabel = (status) =>
    ({
      optimal: '最优解',
      infeasible: '不可行 · 已诊断',
      pass: '验证通过',
      fail: '验证失败 · 已阻断',
      recovered: '恢复通过',
      idle: '已完成',
    })[status] ||
    status ||
    '已验证'
  const familyLabel = (family) =>
    ({ lp: 'LP', milp: 'MILP', qp: 'QP', miqp: 'MIQP', qcp: 'QCP', miqcp: 'MIQCP', cp: 'CP' })[
      String(family).toLowerCase()
    ] || String(family).toUpperCase()
  const shortHash = (value) => (value ? `${value.slice(0, 10)}…${value.slice(-8)}` : '不适用')
  const formatTime = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录')
  const state = { current: 0, filter: 'ALL', query: '', chapter: null, lightboxIndex: 0, visible: manifest.chapters }
  const viewer = {
    zoom: 1,
    fitScale: 1,
    mode: 'fit',
    pointers: new Map(),
    drag: null,
    pinch: null,
    resizeFrame: 0,
  }
  const MIN_VIEWER_ZOOM = 0.5
  const MAX_VIEWER_ZOOM = 12
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = src
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  async function loadChapter(index) {
    const item = manifest.chapters[index]
    if (!item) return
    if (!window.__REPORT_CHAPTERS__[item.scenarioId]) {
      if (location.protocol === 'file:') await loadScript(item.script)
      else {
        const response = await fetch(item.json)
        if (!response.ok) throw new Error(`chapter load failed: ${response.status}`)
        window.__REPORT_CHAPTERS__[item.scenarioId] = await response.json()
      }
    }
    state.current = index
    state.chapter = window.__REPORT_CHAPTERS__[item.scenarioId]
    renderChapter()
    renderNav()
    updatePager()
    updateHash()
    $('#chapter').focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function updateHash() {
    const desired = `#case-${state.current + 1}`
    if (location.hash !== desired) history.replaceState(null, '', desired)
  }
  function hashIndex() {
    const caseMatch = /^#case-(\d+)$/.exec(location.hash)
    if (caseMatch) return Math.max(0, Math.min(manifest.chapters.length - 1, Number(caseMatch[1]) - 1))
    const id = decodeURIComponent(location.hash.slice(1))
    const index = manifest.chapters.findIndex((item) => item.scenarioId === id)
    return index >= 0 ? index : 0
  }

  function renderShell() {
    $('#rail-summary').innerHTML =
      `<span><b>${manifest.counts.chapters}</b>场景</span><span><b>${manifest.counts.decisionTrees}</b>决策树</span><span><b>${manifest.counts.screenshots}</b>真机图</span><span><b>${manifest.counts.representativeStabilityPasses}</b>稳定运行</span>`
    $('#build-id').textContent = manifest.buildId
    const families = ['ALL', ...new Set(manifest.chapters.map((item) => familyLabel(item.problemFamily)))]
    $('#filters').innerHTML = families
      .map(
        (family) =>
          `<button class="filter${family === 'ALL' ? ' active' : ''}" data-family="${esc(family)}">${family === 'ALL' ? '全部' : family}</button>`
      )
      .join('')
    $('#filters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-family]')
      if (!button) return
      state.filter = button.dataset.family
      document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button))
      applyNavFilter()
    })
    $('#chapter-search').addEventListener('input', (event) => {
      state.query = event.target.value.trim().toLowerCase()
      applyNavFilter()
    })
    $('#print-button').addEventListener('click', () => window.print())
    $('#menu-button').addEventListener('click', () => $('.rail').classList.toggle('open'))
    $('#prev-button').addEventListener('click', () =>
      loadChapter((state.current - 1 + manifest.chapters.length) % manifest.chapters.length)
    )
    $('#next-button').addEventListener('click', () => loadChapter((state.current + 1) % manifest.chapters.length))
    $('#latest-button').addEventListener('click', openLatestRegression)
    $('#integrity-button').addEventListener('click', openIntegrity)
    $('#integrity-dialog .dialog-close').addEventListener('click', () => $('#integrity-dialog').close())
    $('#latest-dialog .dialog-close').addEventListener('click', () => $('#latest-dialog').close())
    renderNav()
  }

  function renderLatestRegressionBanner() {
    const regression = manifest.latestPlatformRegression
    if (!regression) return ''
    const scenarios = regression.runtime?.scenarios ?? []
    const passed = scenarios.filter((item) => item.status === 'passed').length
    return `<section class="regression-banner"><div class="regression-mark">NEW</div><div class="regression-copy"><small>最新平台定向回归 · ${esc(formatTime(regression.testedAt))}</small><strong>${esc(regression.platform.commit.slice(0, 10))} 已通过 ${passed}/${scenarios.length} 个真实场景与决策工作台真机检查</strong><span>下方 24 章仍保持原始证据提交 ${esc(manifest.evidencePlatformCommit)} 的归属，不把历史截图冒充为新版重跑。</span></div><button type="button" data-open-regression>查看范围与结论</button></section>`
  }

  function applyNavFilter() {
    state.visible = manifest.chapters.filter((item) => {
      const familyOk = state.filter === 'ALL' || familyLabel(item.problemFamily) === state.filter
      const haystack = `${item.title} ${item.story} ${item.problemFamily} ${item.engineId}`.toLowerCase()
      return familyOk && (!state.query || haystack.includes(state.query))
    })
    renderNav()
  }

  function renderNav() {
    $('#chapter-nav').innerHTML =
      state.visible
        .map((item) => {
          const actualIndex = manifest.chapters.indexOf(item)
          return `<button class="nav-item${actualIndex === state.current ? ' active' : ''}" data-index="${actualIndex}"><span class="nav-index">${String(item.order).padStart(2, '0')}</span><span class="nav-copy"><strong>${esc(item.title)}</strong><small>${familyLabel(item.problemFamily)} · ${esc(item.engineId || '独立校核')}</small></span><i class="nav-status ${statusTone(item.resultStatus)}"></i></button>`
        })
        .join('') || '<p class="empty">没有匹配的章节</p>'
    $('#chapter-nav')
      .querySelectorAll('[data-index]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          $('.rail').classList.remove('open')
          loadChapter(Number(button.dataset.index))
        })
      )
    $('#chapter-nav .active')?.scrollIntoView({ block: 'nearest' })
  }

  function renderTimeline(chapter) {
    const visible = chapter.timeline.filter((item) => item.kind === 'tool' || !item.empty)
    const finalMessageSequence = Math.max(
      ...visible.filter((item) => item.kind === 'message' && item.role === 'assistant').map((item) => item.sequence)
    )
    return visible
      .map((item) => {
        if (item.kind === 'tool')
          return `<div class="tool-event"><span>受治理工具</span><strong>${esc(item.tool)}</strong><span class="status ${item.status === 'success' ? 'pass' : 'guard'}">${esc(item.status)}</span>${item.durationMs == null ? '' : `<span>${item.durationMs} ms</span>`}</div>`
        const isFinal = item.role === 'assistant' && item.sequence === finalMessageSequence
        const body = isFinal
          ? `<details class="full-final"><summary>智能体最终完整报告（原始 Markdown 1:1 渲染）</summary><div class="markdown">${item.html}</div></details>`
          : `<div class="message-body markdown">${item.html}</div>`
        return `<div class="message ${item.role}"><div class="message-meta"><strong>${item.role === 'user' ? '用户' : '求解决策顾问'}</strong><span>消息 ${item.sequence} · SHA ${shortHash(item.markdownSha256)}</span></div>${body}</div>`
      })
      .join('')
  }

  const ownerLabel = (owner) =>
    ({ human: '人类确认', agent: 'Agent 推导', shared: '人 + Agent', validator: '独立校核', platform: '平台执行' })[
      owner
    ] || owner
  const kindLabel = (kind) =>
    ({ context: '决策背景', question: '判断门', action: '执行', check: '校核门', outcome: '结果' })[kind] || kind

  function decisionTreePath(tree) {
    const nodes = new Map(tree.nodes.map((node) => [node.id, node]))
    const selected = new Map(tree.edges.filter((edge) => edge.selected).map((edge) => [edge.from, edge]))
    const path = []
    const visited = new Set()
    let current = tree.rootNodeId
    while (nodes.has(current) && !visited.has(current)) {
      visited.add(current)
      path.push(nodes.get(current))
      current = selected.get(current)?.to
    }
    return path
  }

  function renderTreeNode(node, branch = false) {
    return `<article class="tree-node ${esc(node.status)}${branch ? ' branch' : ''}" data-tree-node="${esc(node.id)}">
      <div class="tree-node-top"><span class="tree-owner ${esc(node.owner)}">${esc(ownerLabel(node.owner))}</span><span class="tree-kind">${esc(kindLabel(node.kind))}</span></div>
      <h3>${esc(node.title)}</h3><p>${esc(node.detail)}</p>
      <a href="${esc(node.evidenceRef)}">查看关联证据 →</a>
    </article>`
  }

  function renderDecisionTree(tree) {
    const path = decisionTreePath(tree)
    const nodes = new Map(tree.nodes.map((node) => [node.id, node]))
    const selectedEdges = new Map(tree.edges.filter((edge) => edge.selected).map((edge) => [edge.from, edge]))
    const stages = path
      .map((node, index) => {
        const nextEdge = selectedEdges.get(node.id)
        const alternatives = tree.edges
          .filter((edge) => edge.from === node.id && !edge.selected)
          .map(
            (edge) =>
              `<div class="tree-alternative"><span>${esc(edge.label)}</span>${renderTreeNode(nodes.get(edge.to), true)}</div>`
          )
          .join('')
        return `<div class="tree-stage" role="listitem">${renderTreeNode(node)}${alternatives ? `<div class="tree-alternatives">${alternatives}</div>` : ''}${index < path.length - 1 ? `<div class="tree-connector ${esc(nextEdge.tone)}"><span>${esc(nextEdge.label)}</span><i aria-hidden="true">→</i></div>` : ''}</div>`
      })
      .join('')
    return `<div class="decision-tree" data-decision-tree>
      <div class="tree-toolbar"><div class="tree-legend" aria-label="决策树职责图例"><span class="human">人类确认</span><span class="agent">Agent 推导</span><span class="validator">独立校核</span><span class="blocked">阻断分支</span></div><div class="tree-actions"><button type="button" data-tree-mode aria-pressed="false">只看实际路径</button><button type="button" data-tree-export>下载 SVG</button></div></div>
      <div class="tree-scroll" tabindex="0" aria-label="${esc(`场景决策树：${state.chapter.title}`)}"><div class="tree-flow" role="list">${stages}</div></div>
      <div class="tree-proof"><span>当前实际路径以实线连接；旁路展示系统何时必须补问或阻断。</span><code>PACK ${esc(shortHash(tree.evidenceBindings.scenarioPackSha256))} · RUN ${esc(shortHash(tree.evidenceBindings.runId))}</code></div>
    </div>`
  }

  const svgTextLines = (value, max = 18, lines = 3) => {
    const chars = [...String(value)]
    const result = []
    while (chars.length && result.length < lines) result.push(chars.splice(0, max).join(''))
    if (chars.length) result[result.length - 1] = `${result[result.length - 1].slice(0, -1)}…`
    return result
  }

  function downloadDecisionTreeSvg(c) {
    const path = decisionTreePath(c.decisionTree)
    const width = Math.max(1200, path.length * 230 + 100)
    const height = 420
    const cards = path
      .map((node, index) => {
        const x = 50 + index * 230
        const title = svgTextLines(node.title)
          .map(
            (line, lineIndex) =>
              `<text x="${x + 16}" y="${112 + lineIndex * 22}" font-size="15" font-weight="700" fill="#172238">${esc(line)}</text>`
          )
          .join('')
        const detail = svgTextLines(node.detail, 22, 3)
          .map(
            (line, lineIndex) =>
              `<text x="${x + 16}" y="${194 + lineIndex * 18}" font-size="11" fill="#637089">${esc(line)}</text>`
          )
          .join('')
        const connector =
          index < path.length - 1
            ? `<path d="M ${x + 190} 174 H ${x + 222}" stroke="#23b8b2" stroke-width="3"/><path d="M ${x + 216} 168 L ${x + 224} 174 L ${x + 216} 180" fill="none" stroke="#23b8b2" stroke-width="3"/>`
            : ''
        return `<g><rect x="${x}" y="64" width="190" height="210" rx="16" fill="#fff" stroke="#dce3ed"/><rect x="${x}" y="64" width="190" height="8" rx="4" fill="${node.status === 'blocked' ? '#d95c63' : '#23b8b2'}"/><text x="${x + 16}" y="94" font-size="11" font-weight="700" fill="#477070">${esc(ownerLabel(node.owner))}</text>${title}${detail}${connector}</g>`
      })
      .join('')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#eef2f7"/><text x="50" y="35" font-size="22" font-weight="800" fill="#172238">${esc(c.title)} · 人 + Agent 决策树</text>${cards}<text x="50" y="316" font-size="13" font-weight="700" fill="#172238">实际证据路径</text><text x="50" y="342" font-size="12" fill="#637089">场景 ${esc(c.scenarioId)} · ${esc(c.decisionTree.evidenceBindings.scenarioPackSha256)}</text><text x="50" y="370" font-size="12" fill="#637089">此 SVG 由验证书中的结构化决策树即时导出；完整旁路与证据链接请在 Web 页面审阅。</text></svg>`
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${c.scenarioId.replace(/[^a-z0-9._-]/gi, '-')}-decision-tree.svg`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function renderChapter() {
    const c = state.chapter
    const tone = statusTone(c.resultStatus)
    const hard = c.validation?.satisfaction_report?.hard_constraints
    const soft = c.validation?.satisfaction_report?.soft_constraints
    $('#chapter').innerHTML = `${renderLatestRegressionBanner()}
      <section class="chapter-hero">
        <div class="eyebrow"><span>CHAPTER ${String(c.scenarioOrder).padStart(2, '0')}</span><span class="badge">${familyLabel(c.problemFamily)}</span><span class="badge">${statusLabel(c.resultStatus)}</span><span class="badge">${esc(c.claimBoundary)}</span></div>
        <h1>${esc(c.title)}</h1><p class="story">${esc(c.story)}</p>
        <div class="hero-grid"><div class="hero-card"><small>决策问题</small><strong>${esc(c.decision)}</strong></div><div class="hero-card"><small>专业结论</small><strong>${esc(c.professionalSummary)}</strong></div></div>
      </section>
      <section class="kpis">
        <div class="kpi"><small>问题族</small><strong>${familyLabel(c.problemFamily)}</strong></div>
        <div class="kpi"><small>实际引擎</small><strong>${esc(c.engineId || '独立校核')}</strong></div>
        <div class="kpi"><small>结果 / 校核</small><strong class="status ${tone}">${statusLabel(c.resultStatus)} / ${esc(c.validationVerdict || '不适用')}</strong></div>
        <div class="kpi"><small>人机决策树</small><strong>${c.decisionTree.nodes.length} 节点 · 证据绑定</strong></div>
        <div class="kpi"><small>真实消息 / 工具</small><strong>${c.counts.rawConversationMessages} / ${c.counts.toolEvents}</strong></div>
        <div class="kpi"><small>原生真机截图</small><strong>${c.counts.screenshots} 张 · 2x</strong></div>
      </section>
      <section class="section-shell"><div class="section-head"><div><h2>场景故事与意义</h2><p>为什么这个问题具有代表性，以及哪些业务规则决定可行性。</p></div><span class="evidence-tag">PACK ${esc(c.scenarioVersion)} · ${shortHash(c.contentSha256)}</span></div>
        <div class="hero-grid"><div class="validation-card"><small>目标</small><strong>${c.objectives.map(esc).join('；')}</strong></div><div class="validation-card"><small>基线</small><strong>${esc(c.baseline)}</strong></div></div>
        <div class="validation-card" style="margin-top:12px"><small>硬规则</small><strong>${c.constraints.map(esc).join('；')}</strong></div>
      </section>
      <section class="section-shell decision-tree-section" id="decision-tree"><div class="section-head"><div><h2>人 + Agent 场景决策树</h2><p>从业务确认到交付门禁，展示本次实际路径以及必须补问、拒绝或阻断的旁路。</p></div><span class="evidence-tag">EVIDENCE-BOUND · ${c.decisionTree.nodes.length} NODES</span></div>${renderDecisionTree(c.decisionTree)}</section>
      <section class="section-shell"><div class="section-head"><div><h2>真实多轮对话</h2><p>普通消息逐条来自 messages.jsonl；工具事件来自持久回执，未用离线脚本改写对话。</p></div><span class="evidence-tag">RUN ${shortHash(c.evidence.runId)}</span></div><div class="timeline">${renderTimeline(c)}</div></section>
      <section class="section-shell"><div class="section-head"><div><h2>智能体最终十部分报告</h2><p>十个 section ID、数量和顺序固定；正文由最终消息 Markdown 原样构建。</p></div><span class="evidence-tag">${c.formulaStats.rendered} FORMULAS · HTML+MATHML</span></div><div class="report-grid">${c.sections.map((section) => `<section class="report-part" id="${section.id}"><div class="part-number">${section.number}</div><div class="part-body"><h3>${esc(section.title)}</h3><div class="markdown">${section.html}</div></div></section>`).join('')}</div></section>
      <section class="section-shell"><div class="section-head"><div><h2>专业校核与稳定性</h2><p>求解结果、独立验证、等价 formulation 和重复运行分别留证。</p></div><span class="evidence-tag">${esc(c.stability.policy)}</span></div>
        <div class="validation-grid"><div class="validation-card"><small>硬约束</small><strong>${hard ? `${hard.satisfied}/${hard.total} 满足，最大违反 ${hard.max_violation}` : '诊断/候选模式，详见第 8 节'}</strong></div><div class="validation-card"><small>软约束</small><strong>${soft ? `${soft.violated}/${soft.total} 违反，罚分 ${soft.weighted_penalty_sum}` : '无或不适用'}</strong></div><div class="validation-card"><small>稳定性</small><strong>${c.stability.effectivePasses} 次有效通过${c.stability.semanticConvergence ? '，语义收敛' : ''}</strong></div></div>
        <div class="validation-grid" style="margin-top:12px"><div class="validation-card"><small>OptimizationSpec</small><strong>${shortHash(c.evidence.optimizationSpecSha256)}</strong></div><div class="validation-card"><small>Result payload</small><strong>${shortHash(c.evidence.resultPayloadSha256)}</strong></div><div class="validation-card"><small>Validation report</small><strong>${shortHash(c.evidence.validationReportSha256)}</strong></div></div>
      </section>
      <section class="section-shell"><div class="section-head"><div><h2>真机完整过程</h2><p>DesireCore 原生窗口 backing store，应用尺寸不变，点击可查看 3024×1824 原图。</p></div><span class="evidence-tag">DEVTOOLS CLOSED</span></div><div class="gallery">${c.media.map((shot, index) => `<button type="button" class="shot" data-shot="${index}" aria-haspopup="dialog" aria-label="查看原图：${esc(shot.alt)}"><picture><source srcset="${shot.thumb1512} 1512w, ${shot.thumb756} 756w" type="image/webp"><img src="${shot.thumb756}" loading="lazy" decoding="async" width="756" height="456" alt="${esc(shot.alt)}"></picture><span class="shot-caption"><span>${index + 1}/${c.media.length} · ${esc(shot.stage)}</span><span>${shortHash(shot.sha256)}</span></span></button>`).join('')}</div></section>`
    $('#chapter')
      .querySelectorAll('[data-shot]')
      .forEach((item) => {
        item.addEventListener('click', () => openLightbox(Number(item.dataset.shot)))
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openLightbox(Number(item.dataset.shot))
          }
        })
      })
    $('#chapter [data-open-regression]')?.addEventListener('click', openLatestRegression)
    $('#chapter [data-tree-mode]')?.addEventListener('click', (event) => {
      const tree = event.currentTarget.closest('[data-decision-tree]')
      const pathOnly = tree.classList.toggle('path-only')
      event.currentTarget.setAttribute('aria-pressed', String(pathOnly))
      event.currentTarget.textContent = pathOnly ? '显示完整分支' : '只看实际路径'
    })
    $('#chapter [data-tree-export]')?.addEventListener('click', () => downloadDecisionTreeSvg(c))
    document.title = `${String(c.scenarioOrder).padStart(2, '0')} · ${c.title} — ${manifest.title}`
    $('#app').setAttribute('aria-busy', 'false')
  }

  function updatePager() {
    $('#progress-label').textContent = `第 ${state.current + 1} / ${manifest.chapters.length} 章`
    $('#progress-bar').style.width = `${((state.current + 1) / manifest.chapters.length) * 100}%`
    $('#pager-label').textContent = state.chapter.title
  }

  function currentShot() {
    return state.chapter?.media?.[state.lightboxIndex] ?? null
  }

  function calculateFitScale() {
    const shot = currentShot()
    const stage = $('#lightbox-stage')
    if (!shot || !stage.clientWidth || !stage.clientHeight) return 1
    const inset = window.matchMedia('(max-width: 920px)').matches ? 16 : 36
    return Math.min(
      Math.max(1, stage.clientWidth - inset) / shot.width,
      Math.max(1, stage.clientHeight - inset) / shot.height,
      1
    )
  }

  function updateViewerStatus() {
    const stage = $('#lightbox-stage')
    const image = $('#lightbox-image')
    const actualScale = viewer.fitScale * viewer.zoom
    const percent = Math.max(1, Math.round(actualScale * 100))
    $('#lightbox-zoom').textContent =
      viewer.mode === 'fit' ? `${percent}% · 适应` : viewer.mode === 'actual' ? '100% · 1:1' : `${percent}%`
    $('#lightbox-zoom-out').disabled = viewer.zoom <= MIN_VIEWER_ZOOM + 0.001
    $('#lightbox-zoom-in').disabled = viewer.zoom >= MAX_VIEWER_ZOOM - 0.001
    $('#lightbox-fit').setAttribute('aria-pressed', String(viewer.mode === 'fit'))
    $('#lightbox-actual').setAttribute('aria-pressed', String(viewer.mode === 'actual'))
    const rect = image.getBoundingClientRect()
    stage.classList.toggle('is-pannable', rect.width > stage.clientWidth + 1 || rect.height > stage.clientHeight + 1)
  }

  function setViewerZoom(nextZoom, options = {}) {
    const shot = currentShot()
    const stage = $('#lightbox-stage')
    const image = $('#lightbox-image')
    if (!shot || !image.complete || !image.naturalWidth) return

    const before = image.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    const focusClientX = options.clientX ?? stageRect.left + stage.clientWidth / 2
    const focusClientY = options.clientY ?? stageRect.top + stage.clientHeight / 2
    const imageRatioX = before.width ? clamp((focusClientX - before.left) / before.width, 0, 1) : 0.5
    const imageRatioY = before.height ? clamp((focusClientY - before.top) / before.height, 0, 1) : 0.5

    viewer.zoom = clamp(nextZoom, MIN_VIEWER_ZOOM, MAX_VIEWER_ZOOM)
    viewer.mode = options.mode ?? 'manual'
    const actualScale = viewer.fitScale * viewer.zoom
    image.style.width = `${Math.max(1, Math.round(shot.width * actualScale))}px`
    image.style.height = `${Math.max(1, Math.round(shot.height * actualScale))}px`

    const after = image.getBoundingClientRect()
    stage.scrollLeft += after.left + imageRatioX * after.width - focusClientX
    stage.scrollTop += after.top + imageRatioY * after.height - focusClientY
    updateViewerStatus()
  }

  function resetViewer(mode = 'fit') {
    const shot = currentShot()
    const image = $('#lightbox-image')
    const stage = $('#lightbox-stage')
    if (!shot || !image.complete || !image.naturalWidth) return
    viewer.fitScale = calculateFitScale()
    const nextZoom = mode === 'actual' ? 1 / viewer.fitScale : 1
    viewer.zoom = clamp(nextZoom, MIN_VIEWER_ZOOM, MAX_VIEWER_ZOOM)
    viewer.mode = mode === 'actual' && viewer.zoom !== nextZoom ? 'manual' : mode
    const actualScale = viewer.fitScale * viewer.zoom
    image.style.width = `${Math.max(1, Math.round(shot.width * actualScale))}px`
    image.style.height = `${Math.max(1, Math.round(shot.height * actualScale))}px`
    stage.scrollTo({ left: 0, top: 0 })
    updateViewerStatus()
  }

  function zoomViewerBy(factor, event) {
    setViewerZoom(viewer.zoom * factor, {
      clientX: event?.clientX,
      clientY: event?.clientY,
      mode: 'manual',
    })
  }

  function openLightbox(index) {
    state.lightboxIndex = index
    const shot = state.chapter.media[index]
    $('#lightbox-title').textContent = `${state.chapter.title} · ${index + 1}/${state.chapter.media.length}`
    $('#lightbox-meta').textContent = `${shot.width}×${shot.height} · SHA-256 ${shot.sha256}`
    const image = $('#lightbox-image')
    image.alt = shot.alt
    image.onload = () => resetViewer('fit')
    image.src = shot.original
    $('#lightbox-original').href = shot.original
    if (!$('#lightbox').open) $('#lightbox').showModal()
    if (image.complete && image.naturalWidth) requestAnimationFrame(() => resetViewer('fit'))
  }
  $('#lightbox-close').addEventListener('click', () => $('#lightbox').close())
  $('#lightbox-prev').addEventListener('click', () =>
    openLightbox((state.lightboxIndex - 1 + state.chapter.media.length) % state.chapter.media.length)
  )
  $('#lightbox-next').addEventListener('click', () =>
    openLightbox((state.lightboxIndex + 1) % state.chapter.media.length)
  )
  $('#lightbox-zoom-out').addEventListener('click', () => zoomViewerBy(1 / 1.25))
  $('#lightbox-zoom-in').addEventListener('click', () => zoomViewerBy(1.25))
  $('#lightbox-fit').addEventListener('click', () => resetViewer('fit'))
  $('#lightbox-actual').addEventListener('click', () => resetViewer('actual'))
  $('#lightbox-stage').addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      zoomViewerBy(event.deltaY < 0 ? 1.18 : 1 / 1.18, event)
    },
    { passive: false }
  )
  $('#lightbox-stage').addEventListener('dblclick', (event) => {
    if (viewer.mode === 'fit') setViewerZoom(2, { clientX: event.clientX, clientY: event.clientY })
    else resetViewer('fit')
  })
  $('#lightbox-stage').addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const stage = $('#lightbox-stage')
    if (viewer.pointers.size >= 2) return
    viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    stage.setPointerCapture?.(event.pointerId)
    if (viewer.pointers.size === 2) {
      const [first, second] = [...viewer.pointers.values()]
      viewer.pinch = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: viewer.zoom,
      }
      viewer.drag = null
      stage.classList.remove('is-dragging')
    } else if (stage.classList.contains('is-pannable')) {
      viewer.drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: stage.scrollLeft,
        top: stage.scrollTop,
      }
      stage.classList.add('is-dragging')
    }
  })
  $('#lightbox-stage').addEventListener('pointermove', (event) => {
    if (!viewer.pointers.has(event.pointerId)) return
    const stage = $('#lightbox-stage')
    viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (viewer.pointers.size >= 2 && viewer.pinch) {
      const [first, second] = [...viewer.pointers.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      setViewerZoom(viewer.pinch.zoom * (distance / Math.max(1, viewer.pinch.distance)), {
        clientX: (first.x + second.x) / 2,
        clientY: (first.y + second.y) / 2,
      })
      return
    }
    if (viewer.drag?.pointerId === event.pointerId) {
      stage.scrollLeft = viewer.drag.left - (event.clientX - viewer.drag.x)
      stage.scrollTop = viewer.drag.top - (event.clientY - viewer.drag.y)
    }
  })
  const releaseViewerPointer = (event) => {
    const stage = $('#lightbox-stage')
    if (!viewer.pointers.has(event.pointerId)) return
    viewer.pointers.delete(event.pointerId)
    viewer.drag = null
    viewer.pinch = null
    stage.classList.remove('is-dragging')
    if (viewer.pointers.size === 1 && stage.classList.contains('is-pannable')) {
      const [[pointerId, point]] = [...viewer.pointers.entries()]
      viewer.drag = {
        pointerId,
        x: point.x,
        y: point.y,
        left: stage.scrollLeft,
        top: stage.scrollTop,
      }
      stage.classList.add('is-dragging')
    }
  }
  $('#lightbox-stage').addEventListener('pointerup', releaseViewerPointer)
  $('#lightbox-stage').addEventListener('pointercancel', releaseViewerPointer)
  $('#lightbox-stage').addEventListener('lostpointercapture', releaseViewerPointer)
  $('#lightbox').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') $('#lightbox-prev').click()
    else if (event.key === 'ArrowRight') $('#lightbox-next').click()
    else if (event.key === '+' || event.key === '=') zoomViewerBy(1.25)
    else if (event.key === '-') zoomViewerBy(1 / 1.25)
    else if (event.key === '0') resetViewer('fit')
    else if (event.key === '1') resetViewer('actual')
    else return
    event.preventDefault()
  })
  $('#lightbox').addEventListener('close', () => {
    viewer.pointers.clear()
    viewer.drag = null
    viewer.pinch = null
    $('#lightbox-stage').classList.remove('is-dragging', 'is-pannable')
  })
  window.addEventListener('resize', () => {
    if (!$('#lightbox').open) return
    cancelAnimationFrame(viewer.resizeFrame)
    viewer.resizeFrame = requestAnimationFrame(() => {
      const previousActualScale = viewer.fitScale * viewer.zoom
      viewer.fitScale = calculateFitScale()
      const nextZoom =
        viewer.mode === 'fit' ? 1 : viewer.mode === 'actual' ? 1 / viewer.fitScale : previousActualScale / viewer.fitScale
      setViewerZoom(nextZoom, { mode: viewer.mode })
    })
  })

  async function openIntegrity() {
    let integrity
    if (location.protocol === 'file:')
      integrity = {
        entries: [],
        note: '离线模式下逐文件哈希见 integrity.json',
        contentRootSha256: manifest.contentRootSha256,
      }
    else integrity = await (await fetch('integrity.json')).json()
    $('#integrity-content').innerHTML =
      `<div class="integrity-list"><div class="integrity-row"><strong>报告内容根哈希</strong><code>${esc(manifest.contentRootSha256)}</code></div><div class="integrity-row"><strong>历史证据根哈希</strong><code>${esc(manifest.historicalEvidenceContentRootSha256)}</code></div><div class="integrity-row"><strong>最新版回归哈希</strong><code>${esc(manifest.latestPlatformRegressionSha256)}</code></div><div class="integrity-row"><strong>章节</strong><span>${manifest.counts.chapters}</span></div><div class="integrity-row"><strong>截图</strong><span>${manifest.counts.screenshots}</span></div><div class="integrity-row"><strong>完整性条目</strong><span>${integrity.entries?.length || '见离线 integrity.json'}</span></div><div class="integrity-row"><strong>历史证据平台 / Skill</strong><span>${esc(manifest.evidencePlatformCommit)} / ${esc(manifest.agentSkillVersion)}</span></div><div class="integrity-row"><strong>最新回归平台</strong><span>${esc(manifest.latestPlatformRegression.platform.commit)}</span></div></div>`
    $('#integrity-dialog').showModal()
  }

  function openLatestRegression() {
    const regression = manifest.latestPlatformRegression
    const scenarios = regression.runtime.scenarios
      .map((item) => {
        const verdict =
          item.expectedValidationVerdict === 'fail' && item.observedValidationVerdict === 'fail'
            ? '违规候选按预期被阻断'
            : `独立验证 ${item.observedValidationVerdict}`
        return `<article class="regression-case"><div><span class="status pass">通过</span><small>${esc(item.scenarioId)}</small></div><h3>${esc(item.label)}</h3><p>${esc(verdict)} · Solve ${item.settledSolveCalls} 次 · 十部分报告 ${item.tenPartReport ? '完整' : '不完整'}</p><code>${esc(shortHash(item.caseRunSha256))}</code></article>`
      })
      .join('')
    const workspace = regression.runtime.decisionWorkspace
    $('#latest-content').innerHTML =
      `<div class="regression-dialog-head"><span class="status pass">PASS</span><p>最新平台定向回归</p><h2>${esc(regression.platform.commit.slice(0, 10))} · DesireCore ${esc(regression.platform.version)}</h2><small>${esc(formatTime(regression.testedAt))} · ${esc(regression.platform.source)}</small></div><div class="regression-cases">${scenarios}<article class="regression-case"><div><span class="status pass">通过</span><small>Decision Workspace r${workspace.revision}</small></div><h3>人 + Agent 共管决策工作台</h3><p>业务、模型、证据三视图可用；定义通过，缺少模型映射时保持阻断；${workspace.viewport.join('×')} 无横向溢出。</p><code>review: ${esc(workspace.reviewState)}</code></article></div><section class="regression-boundary"><h3>证据边界</h3><ul>${regression.claimBoundary.map((item) => `<li>${esc(item)}</li>`).join('')}</ul><p><strong>历史全量证据：</strong>${regression.historicalEvidence.chapters} 章、${regression.historicalEvidence.screenshots} 张截图、${regression.historicalEvidence.representativeStabilityPasses} 次代表性稳定运行，归属于平台 ${esc(regression.historicalEvidence.platformCommit)}。</p></section>`
    $('#latest-dialog').showModal()
  }

  window.addEventListener('hashchange', () => {
    const index = hashIndex()
    if (index !== state.current) loadChapter(index)
  })
  renderShell()
  loadChapter(hashIndex()).catch((error) => {
    $('#chapter').innerHTML =
      `<section class="section-shell"><h1>报告载入失败</h1><pre>${esc(error.stack || error.message)}</pre></section>`
    throw error
  })
})()
