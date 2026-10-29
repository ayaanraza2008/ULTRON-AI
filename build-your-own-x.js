/**
 * Task-aware, read-only learning index for codecrafters-io/build-your-own-x.
 *
 * The upstream repository is a curated tutorial index, not an installable runtime.
 * This module routes relevant references and first-principles guidance into ULTRON.
 * It never fetches, installs, or executes tutorial code.
 */
const UPSTREAM_REVISION = "aa17439b62f384511a5561ce308e9598b94d8989";
const UPSTREAM_README = "https://github.com/codecrafters-io/build-your-own-x/blob/" + UPSTREAM_REVISION + "/README.md";
const FIT_RANK = Object.freeze({ core: 4, useful: 3, specialized: 2, low: 1 });

const TOPICS = [
  {
    id: "distributed-systems", title: "Distributed Systems", tutorialCount: 1, fit: "core",
    anchor: "build-your-own-distributed-systems",
    matches: /\b(distributed system|message broker|event stream|pub\s*\/\s*sub|kafka|consumer group|queue partition|replication|idempotenc|retry storm)\b/i,
    guidance: "Apply durable task states, idempotent retries, bounded queues, explicit cancellation, backpressure, and observable worker failures. Do not introduce a distributed system where the current single-service architecture is sufficient.",
    references: [{ title: "Build your own Kafka-like system", url: "https://github.com/buildthingsuseful/build-your-own-kafka" }]
  },
  {
    id: "3d-renderer", title: "3D Renderer", tutorialCount: 11, fit: "specialized",
    anchor: "build-your-own-3d-renderer",
    matches: /\b(3d renderer|ray tracing|render engine|3d graphics engine|software rendering|webgl renderer)\b/i,
    guidance: "Use only for an explicitly requested 3D visualization or model-preview feature. Prefer a mature renderer and lazy-loaded previews over a custom graphics engine in ULTRON's core.",
    references: [{ title: "Tiny Renderer", url: "https://github.com/ssloy/tinyrenderer/wiki" }]
  },
  {
    id: "ai-model", title: "AI Model and RAG", tutorialCount: 3, fit: "core",
    anchor: "build-your-own-ai-model",
    matches: /\b(ultron ai|ai model|large language model|llm|tokenizer|transformer|model inference|fine[- ]?tun(?:e|ing)|diffusion model|build (?:an? )?(?:ai|language|llm|generative) model|rag|retrieval[- ]?augmented generation|vector store|embedding model|embeddings?)\b/i,
    guidance: "Understand tokenizer/context limits, provider capability differences, structured tool calls, retrieval-augmented generation, citation grounding, evaluation, and fallback semantics. Reuse mature model libraries and existing ULTRON provider adapters; do not train or download a large model by default.",
    references: [
      { title: "LLMs from scratch", url: "https://github.com/rasbt/LLMs-from-scratch" },
      { title: "RAG from scratch", url: "https://github.com/langchain-ai/rag-from-scratch" }
    ]
  },
  {
    id: "augmented-reality", title: "Augmented Reality", tutorialCount: 6, fit: "specialized",
    anchor: "build-your-own-augmented-reality",
    matches: /\b(augmented reality|\barcore\b|\barkit\b|spatial overlay|world-anchored overlay)\b/i,
    guidance: "Treat AR as an optional mobile/device experience requiring compatible sensors, permissions, rendering support, and hardware tests. It is not a prerequisite for the ULTRON desktop assistant.",
    references: [{ title: "Augmented Reality with Python and OpenCV", url: "https://bitesofcode.wordpress.com/2017/09/12/augmented-reality-with-python-and-opencv-part-1/" }]
  },
  {
    id: "bittorrent-client", title: "BitTorrent Client", tutorialCount: 5, fit: "low",
    anchor: "build-your-own-bittorrent-client",
    matches: /\b(bittorrent|torrent client|bencode parser|peer swarm)\b/i,
    guidance: "Only relevant for an explicitly requested, lawful peer-to-peer transfer feature. Do not add a torrent engine to the assistant core."
  },
  {
    id: "blockchain-cryptocurrency", title: "Blockchain and Cryptocurrency", tutorialCount: 21, fit: "low",
    anchor: "build-your-own-blockchain--cryptocurrency",
    matches: /\b(blockchain|cryptocurrency|smart contract|proof of work|proof of stake|wallet transaction)\b/i,
    guidance: "Treat as a separate domain-specific module only when directly requested. Do not add wallets, transaction signing, or financial actions as ambient assistant capabilities."
  },
  {
    id: "bot", title: "Bots and Conversational Agents", tutorialCount: 15, fit: "core",
    anchor: "build-your-own-bot",
    matches: /\b(chatbot|conversational agent|messaging bot|telegram bot|discord bot|assistant architecture|agent orchestration|ultron assistant|multi[- ]agent|agent team)\b/i,
    guidance: "Build one orchestrator with a typed tool registry, bounded agent delegation, explicit task state, per-tool permissions, cancellation, and evidence-based results. Specialist agents must not become isolated chat demos or bypass shared authorization.",
    references: [{ title: "Responsive Telegram bot tutorial", url: "https://www.sohamkamani.com/blog/2016/09/21/making-a-telegram-bot/" }]
  },
  {
    id: "command-line-tool", title: "Command-Line Tools", tutorialCount: 9, fit: "core",
    anchor: "build-your-own-command-line-tool",
    matches: /\b(cli|command[- ]line tool|terminal utility|developer diagnostics command|local assistant cli|argument parser)\b/i,
    guidance: "Prefer a small, typed CLI for health checks, diagnostics, local model benchmarking, and reproducible workflows. Validate arguments, provide actionable errors, redact secrets, and avoid introducing a second source of truth for configuration.",
    references: [{ title: "Rust Command Line Applications book", url: "https://rust-cli.github.io/book/index.html" }]
  },
  {
    id: "database", title: "Databases and Persistence", tutorialCount: 13, fit: "core",
    anchor: "build-your-own-database",
    matches: /\b(database|sql schema|schema migration|transaction|persistent storage|data store|key[- ]value store|redis|sqlite|postgres|row level security|data integrity)\b/i,
    guidance: "Use established storage engines and the existing Supabase/data architecture. Improve migration ordering, ownership checks, idempotency, rollback strategy, indexes, and integration tests rather than creating a new database engine.",
    references: [{ title: "Let's Build a Simple Database", url: "https://cstack.github.io/db_tutorial/" }]
  },
  {
    id: "docker", title: "Containers and Isolation", tutorialCount: 6, fit: "useful",
    anchor: "build-your-own-docker",
    matches: /\b(docker|container(?:ization)?|sandbox untrusted code|container sandbox|isolate code execution|namespaces|cgroups)\b/i,
    guidance: "For untrusted code, use a maintained isolation/runtime boundary with explicit filesystem, network, CPU, memory, and time limits. Do not implement a toy container and mistake it for a security boundary.",
    references: [{ title: "Linux containers in 500 lines", url: "https://blog.lizzie.io/linux-containers-in-500-loc.html" }]
  },
  {
    id: "emulator-virtual-machine", title: "Emulators and Virtual Machines", tutorialCount: 13, fit: "specialized",
    anchor: "build-your-own-emulator--virtual-machine",
    matches: /\b(emulator|virtual machine|bytecode interpreter|chip[- ]?8|instruction set emulator)\b/i,
    guidance: "Relevant only for a specific compatibility or educational runtime. For executing user code, prefer a maintained sandbox instead of treating a custom emulator as the default isolation boundary."
  },
  {
    id: "frontend-framework", title: "Front-End Frameworks and Rendering", tutorialCount: 14, fit: "useful",
    anchor: "build-your-own-front-end-framework--library",
    matches: /\b(front[- ]end framework|react reconciler|virtual dom|jsx renderer|state management|component renderer|frontend rendering engine)\b/i,
    guidance: "Improve ULTRON's current frontend using its existing framework, component patterns, state conventions, accessibility, and regression tests. Do not build a new UI framework as part of a normal feature request.",
    references: [{ title: "Build your own React", url: "https://pomb.us/build-your-own-react/" }]
  },
  {
    id: "game", title: "Game Engines", tutorialCount: 34, fit: "low",
    anchor: "build-your-own-game",
    matches: /\b(game engine|game loop|chess engine|game programming|nes game|roguelike)\b/i,
    guidance: "Keep game development as a separate creative capability if explicitly requested. It should not add continuous CPU/GPU load to the assistant by default."
  },
  {
    id: "git", title: "Git and Version Control", tutorialCount: 7, fit: "core",
    anchor: "build-your-own-git",
    matches: /\b(git internals|git clone implementation|object database|git tree|git commit internals|version control implementation)\b/i,
    guidance: "Use the real Git tooling for repository changes. Coding workflows should inspect the branch and diff, preserve user modifications, use reviewable commits, and never force-push or overwrite unrelated work.",
    references: [{ title: "Build Git to learn Git", url: "https://kushagra.dev/blog/build-git-learn-git/" }]
  },
  {
    id: "memory-allocator", title: "Memory Allocation and Resource Management", tutorialCount: 1, fit: "useful",
    anchor: "build-your-own-memory-allocator",
    matches: /\b(memory allocator|memory leak|heap allocation|resource exhaustion|bounded buffer|memory budget|out of memory|oom)\b/i,
    guidance: "Use measured resource budgets, bounded queues/buffers, cleanup and cancellation. Do not build a custom allocator for normal Node.js features; profile before optimizing."
  },
  {
    id: "network-stack", title: "Networking and Protocols", tutorialCount: 4, fit: "core",
    anchor: "build-your-own-network-stack",
    matches: /\b(network stack|tcp\/ip|dns rebinding|ssrf|http protocol|tls|socket protocol|network security|request timeout|dns resolution)\b/i,
    guidance: "Use safe outbound-request policies, HTTPS, redirect validation, timeouts, size limits, DNS/IP checks, and typed errors. Reuse existing network-safety helpers; do not create an unrestricted URL-fetching path.",
    references: [{ title: "Beej's Guide to Network Programming", url: "https://beej.us/guide/bgnet/" }]
  },
  {
    id: "neural-network", title: "Neural Networks", tutorialCount: 17, fit: "useful",
    anchor: "build-your-own-neural-network",
    matches: /\b(neural network|training loop|backpropagation|model evaluation|classification model|ocr model|embedding model|machine learning pipeline)\b/i,
    guidance: "Prefer tested local or hosted model adapters for production features. Add model evaluation, dataset provenance, resource requirements, confidence limitations and reproducible benchmarks before considering custom training."
  },
  {
    id: "operating-system", title: "Operating Systems and Desktop APIs", tutorialCount: 19, fit: "core",
    anchor: "build-your-own-operating-system",
    matches: /\b(operating system|windows api|desktop companion|system call|process isolation|process management|file permissions|pc control|keyboard automation|clipboard api|desktop automation|windows service)\b/i,
    guidance: "Use platform-supported APIs behind a narrow, permission-checked desktop bridge. Keep the UI and API process unprivileged, validate all paths and actions, and show visible status for microphone, camera, screen, and system operations."
  },
  {
    id: "physics-engine", title: "Physics Engines", tutorialCount: 7, fit: "low",
    anchor: "build-your-own-physics-engine",
    matches: /\b(physics engine|rigid body dynamics|collision simulation|physics simulation)\b/i,
    guidance: "Keep domain-specific simulation optional and isolated from the core assistant runtime."
  },
  {
    id: "processor", title: "Processors and Hardware", tutorialCount: 1, fit: "low",
    anchor: "build-your-own-processor",
    matches: /\b(processor design|risc[- ]?v|fpga|verilog|cpu instruction set implementation)\b/i,
    guidance: "This is educational hardware work, not a requirement for ULTRON's AI runtime. Do not add hardware-emulation dependencies to the main application."
  },
  {
    id: "programming-language", title: "Programming Languages and Interpreters", tutorialCount: 41, fit: "useful",
    anchor: "build-your-own-programming-language",
    matches: /\b(programming language implementation|write an interpreter|compiler construction|parser combinator|ast parser|domain[- ]specific language|workflow dsl|bytecode compiler)\b/i,
    guidance: "For the workflow editor, use a small declarative schema and explicit node types rather than evaluating arbitrary generated JavaScript. Validate syntax and types, and reject unknown or unsafe operations.",
    references: [{ title: "Make a Lisp", url: "https://github.com/kanaka/mal#mal---make-a-lisp" }]
  },
  {
    id: "regex-engine", title: "Regular Expression Engines", tutorialCount: 9, fit: "useful",
    anchor: "build-your-own-regex-engine",
    matches: /\b(regex engine|regular expression engine|catastrophic backtracking|regex denial of service|regex performance)\b/i,
    guidance: "Use bounded input and known-safe regular expressions in routing or validation. Add adversarial tests for pathological inputs; never evaluate user-supplied patterns without a safe execution strategy.",
    references: [{ title: "Regular Expression Matching Can Be Simple And Fast", url: "https://swtch.com/~rsc/regexp/regexp1.html" }]
  },
  {
    id: "search-engine", title: "Search Engines and Information Retrieval", tutorialCount: 6, fit: "core",
    anchor: "build-your-own-search-engine",
    matches: /\b(search engine|semantic search|document search|full[- ]text search|vector search|retrieval|indexing pipeline|rank search results|knowledge retrieval|rag)\b/i,
    guidance: "Use a maintainable retrieval pipeline: parse allowed documents, chunk with stable provenance, index incrementally, retrieve relevant evidence, cite source locations, and test relevance and stale-index behaviour. Keep user data scoped and honour opt-out/deletion.",
    references: [{ title: "Building a Vector Space Indexing Engine", url: "https://boyter.org/2010/08/build-vector-space-search-engine-python/" }]
  },
  {
    id: "shell", title: "Shells and Command Execution", tutorialCount: 7, fit: "core",
    anchor: "build-your-own-shell",
    matches: /\b(shell|execute command|command execution|subprocess|terminal access|shell injection|run a script|shell command)\b/i,
    guidance: "Never pass untrusted model output into a shell string. Prefer named commands with validated argument arrays, explicit working directories, timeouts, output caps, cancellation, and approval for risky commands.",
    references: [{ title: "Write a Shell in C", url: "https://brennan.io/2015/01/16/write-a-shell-in-c/" }]
  },
  {
    id: "template-engine", title: "Template Engines and Safe Rendering", tutorialCount: 5, fit: "useful",
    anchor: "build-your-own-template-engine",
    matches: /\b(template engine|server-side templating|template injection|html escaping|safe html rendering|markdown renderer)\b/i,
    guidance: "Use established renderers and context-aware escaping for HTML, Markdown, email, and reports. Treat model output as untrusted content and avoid raw HTML execution by default.",
    references: [{ title: "Building a toy template engine in Python", url: "https://alexmic.net/building-a-template-engine/" }]
  },
  {
    id: "text-editor", title: "Text Editors", tutorialCount: 6, fit: "specialized",
    anchor: "build-your-own-text-editor",
    matches: /\b(text editor implementation|code editor implementation|buffer gap|syntax editing engine|editor keybinding engine)\b/i,
    guidance: "Use a maintained editor component or language server for coding UX. Focus ULTRON work on controlled file diffs, workspace scoping, previews and editor integration instead of building an editor engine."
  },
  {
    id: "visual-recognition", title: "Visual Recognition Systems", tutorialCount: 2, fit: "core",
    anchor: "build-your-own-visual-recognition-system",
    matches: /\b(visual recognition|object detection|ocr|image recognition|computer vision|camera vision|screen vision|face recognition|image classification)\b/i,
    guidance: "Use explicit capture permissions and existing vision/OCR adapters. Distinguish local from cloud processing, bound image/frame payloads, and report model limitations; biometric identity checks need a separately reviewed implementation."
  },
  {
    id: "voxel-engine", title: "Voxel Engines", tutorialCount: 1, fit: "low",
    anchor: "build-your-own-voxel-engine",
    matches: /\b(voxel engine|voxel terrain|voxel renderer)\b/i,
    guidance: "Specialized 3D work only; keep it isolated and lazy-loaded."
  },
  {
    id: "web-browser", title: "Web Browsers and Browser Engines", tutorialCount: 2, fit: "core",
    anchor: "build-your-own-web-browser",
    matches: /\b(browser engine|web browser internals|dom layout engine|browser automation|chrome devtools|inspect a web page|javascript[- ]rendered page|page snapshot)\b/i,
    guidance: "Use the existing browser-use and Chrome DevTools adapters for permitted navigation, DOM inspection and diagnostics. Default to read-only, protect cookies/secrets, block private-network targets, and require approval for consequential page actions.",
    references: [{ title: "Browser Engineering", url: "https://browser.engineering/" }]
  },
  {
    id: "web-server", title: "Web Servers and HTTP APIs", tutorialCount: 11, fit: "core",
    anchor: "build-your-own-web-server",
    matches: /\b(web server|http server|express middleware|api endpoint|rest api|server sent events|server-sent events|sse stream|http streaming|request body limit|api backend|backend route)\b/i,
    guidance: "Keep ULTRON's existing Express API and response contracts. Use bounded request/response bodies, authentication, authorization, timeouts, cancellation, secure headers and regression tests; avoid creating a parallel server for a capability that belongs in the existing backend.",
    references: [
      { title: "Build Your Own Web Server", url: "https://build-your-own.org/webserver/" },
      { title: "Node.js web server with streams", url: "https://www.codementor.io/@ziad-saab/let-s-code-a-web-server-from-scratch-with-nodejs-streams-h4uc9utji" }
    ]
  },
  {
    id: "uncategorized", title: "Uncategorized and First-Principles Tutorials", tutorialCount: 62, fit: "useful",
    anchor: "uncategorized",
    matches: /\b(build-your-own-x|build from first principles|from first principles|learn the internals|understand how .* works from scratch)\b/i,
    guidance: "Use this group only as a discovery index when no named category fits. Inspect each linked project's current status, source, license, data handling and tests before adopting any idea.",
    references: [{ title: "From NAND to Tetris", url: "https://www.nand2tetris.org/" }]
  }
];

function publicTopic(topic) {
  return {
    id: topic.id,
    title: topic.title,
    tutorialCount: topic.tutorialCount,
    fit: topic.fit,
    sourceUrl: UPSTREAM_README + "#" + topic.anchor,
    guidance: topic.guidance,
    references: (topic.references || []).map(reference => ({ ...reference }))
  };
}

export function listBuildYourOwnXTopics() {
  return TOPICS.map(publicTopic);
}

export function buildBuildYourOwnXGuidance(task, options = {}) {
  const text = typeof task === "string" ? task.slice(0, 4000) : "";
  const requestedLimit = Number.isFinite(Number(options.limit)) ? Math.trunc(Number(options.limit)) : 4;
  const limit = Math.max(1, Math.min(5, requestedLimit || 4));
  const matched = TOPICS
    .filter(topic => topic.matches.test(text))
    .sort((a, b) => (FIT_RANK[b.fit] - FIT_RANK[a.fit]) || TOPICS.indexOf(a) - TOPICS.indexOf(b))
    .slice(0, limit)
    .map(publicTopic);

  const rules = matched.map(topic => {
    const referenceText = topic.references.length
      ? " Relevant tutorials: " + topic.references.slice(0, 2).map(reference => reference.title + " (" + reference.url + ")").join("; ") + "."
      : "";
    return "Build-your-own-X reference selected: " + topic.title + ". " + topic.guidance +
      " Treat links as learning references only. Do not fetch and execute tutorial code, blindly copy an implementation, add dependencies, or claim a capability is installed. Adapt only the smallest applicable idea to ULTRON's current architecture, check the specific linked project's license if copying any material, and run relevant regression tests. Index source: " + topic.sourceUrl + "." + referenceText;
  });

  return {
    source: "https://github.com/codecrafters-io/build-your-own-x",
    sourceRevision: UPSTREAM_REVISION,
    catalogTopicCount: TOPICS.length,
    catalogTutorialEntryCount: TOPICS.reduce((sum, topic) => sum + topic.tutorialCount, 0),
    catalogIndexLicense: "CC0-1.0 as stated by the upstream README; linked tutorial contents have their own licenses",
    matched,
    rules
  };
}
