/**
 * ULTRON AI — Agency Agents Capability Matrix & Specialized AI Employee Registry
 * Evaluates and integrates domain workflows from msitarzewski/agency-agents
 *
 * Maps specialized commercial, engineering, marketing, and security agency roles
 * into ULTRON's existing 18-agent orchestrator with bounded schemas, strict review
 * gates, and system prompt policies.
 */

export const AGENCY_DOMAINS = {
  STRATEGY_GROWTH: "STRATEGY_GROWTH",
  ENGINEERING_ARCHITECTURE: "ENGINEERING_ARCHITECTURE",
  CYBERSECURITY_DEFENSE: "CYBERSECURITY_DEFENSE",
  PRODUCT_DESIGN: "PRODUCT_DESIGN",
  CONTENT_MARKETING: "CONTENT_MARKETING",
  OPERATIONS_SRE: "OPERATIONS_SRE"
};

export class AgencyAgentsMatrix {
  constructor() {
    this.roles = new Map();
    this.initializeMatrix();
  }

  initializeMatrix() {
    this.registerRole({
      id: "gtm-growth-strategist",
      title: "Chief Growth & GTM Strategist",
      domain: AGENCY_DOMAINS.STRATEGY_GROWTH,
      mappedUltronAgent: "gtm-engineer",
      upstreamRole: "agency-agents/growth-lead",
      responsibilities: [
        "Develop end-to-end go-to-market roadmaps and product positioning",
        "Formulate data-backed acquisition and conversion channel hypotheses",
        "Design viral loops, referral mechanisms, and customer activation funnels"
      ],
      requiredReviewGate: "HUMAN_APPROVAL_ON_CAMPAIGN_SPEND",
      allowlistedTools: ["web_search", "analyze_analytics_data", "draft_gtm_report"],
      systemDirective: "Act as an elite Growth Architect. Focus on measurable unit economics, LTV/CAC, and non-paid distribution loops. Never commit capital or spend without operator approval."
    });

    this.registerRole({
      id: "seo-aeo-specialist",
      title: "SEO & Answer Engine Optimization Analyst",
      domain: AGENCY_DOMAINS.CONTENT_MARKETING,
      mappedUltronAgent: "seo-aeo",
      upstreamRole: "agency-agents/seo-specialist",
      responsibilities: [
        "Audit technical site structure, Core Web Vitals, and semantic schema markup",
        "Optimize brand entity citations for LLM answer engines (Perplexity, ChatGPT Search, Gemini)",
        "Identify high-intent content clusters and programmatic SEO opportunities"
      ],
      requiredReviewGate: "NONE_READ_ONLY",
      allowlistedTools: ["web_search", "openseo_keyword_research", "audit_schema_markup"],
      systemDirective: "Analyze search landscape and LLM generative visibility. Deliver structured semantic recommendations and citation maps."
    });

    this.registerRole({
      id: "fullstack-architect",
      title: "Senior Full-Stack Architect & Code Reviewer",
      domain: AGENCY_DOMAINS.ENGINEERING_ARCHITECTURE,
      mappedUltronAgent: "web-dev",
      upstreamRole: "agency-agents/tech-lead",
      responsibilities: [
        "Evaluate distributed system architectures, scalability, and modularity",
        "Perform pre-merge security and performance code reviews",
        "Generate paired implementation code and unit test specifications"
      ],
      requiredReviewGate: "COMMIT_REVIEW_GATE",
      allowlistedTools: ["code_shield_scan", "run_sandbox_tests", "generate_code_pair"],
      systemDirective: "Enforce clean code, zero untested paths, and architectural simplicity. Failsafe isolation is non-negotiable."
    });

    this.registerRole({
      id: "cyber-defense-analyst",
      title: "Cyber Defense & Threat Modeling Engineer",
      domain: AGENCY_DOMAINS.CYBERSECURITY_DEFENSE,
      mappedUltronAgent: "cyber-core",
      upstreamRole: "agency-agents/security-analyst",
      responsibilities: [
        "Execute STRIDE threat models and attack surface surface mapping",
        "Audit dependency trees for supply chain vulnerabilities and CVEs",
        "Formulate defensive remediation playbooks for OWASP Top 10 vulnerabilities"
      ],
      requiredReviewGate: "AUTHORIZED_SCOPE_GATE",
      allowlistedTools: ["sast_scan", "dependency_audit", "secret_scan", "target_auth_check"],
      systemDirective: "Maintain strictly ethical, defensive posture. Never perform unauthorized penetration tests or destructive actions."
    });

    this.registerRole({
      id: "product-ux-designer",
      title: "Product Interaction & Systems Designer",
      domain: AGENCY_DOMAINS.PRODUCT_DESIGN,
      mappedUltronAgent: "productivity",
      upstreamRole: "agency-agents/product-designer",
      responsibilities: [
        "Design intuitive component design systems and state machines",
        "Synthesize user feedback into high-fidelity workflow specifications",
        "Generate Mermaid architecture diagrams and ASCII interface wireframes"
      ],
      requiredReviewGate: "NONE_READ_ONLY",
      allowlistedTools: ["render_diagram", "generate_wireframe", "synthesize_feedback"],
      systemDirective: "Focus on user clarity, minimal friction, and dark-theme aesthetic consistency."
    });

    this.registerRole({
      id: "sre-devops-lead",
      title: "Site Reliability & Cloud Infrastructure Lead",
      domain: AGENCY_DOMAINS.OPERATIONS_SRE,
      mappedUltronAgent: "chief-of-staff",
      upstreamRole: "agency-agents/devops-sre",
      responsibilities: [
        "Monitor microservice health, memory telemetry, and response latency",
        "Design zero-downtime CI/CD deployment pipelines and auto-rollback hooks",
        "Investigate root cause anomalies in dead-letter queues and application logs"
      ],
      requiredReviewGate: "DEPLOYMENT_APPROVAL_GATE",
      allowlistedTools: ["system_telemetry", "check_ci_status", "dlq_analysis"],
      systemDirective: "Prioritize uptime, fail-closed security, and resource efficiency. Never deploy without operator consent."
    });
  }

  registerRole(roleMeta) {
    if (!roleMeta.id || !roleMeta.title || !roleMeta.mappedUltronAgent) {
      throw new Error("registerRole requires id, title, and mappedUltronAgent.");
    }
    this.roles.set(roleMeta.id, roleMeta);
    return roleMeta;
  }

  getRole(id) {
    return this.roles.get(id) || null;
  }

  listRoles(domain = null) {
    let list = Array.from(this.roles.values());
    if (domain) {
      list = list.filter(r => r.domain === domain);
    }
    return list;
  }

  /**
   * Assembles a cross-functional agent team for a specified multi-disciplinary project.
   */
  assembleTeam(projectType = "software_launch") {
    switch (projectType) {
      case "software_launch":
        return [
          this.getRole("fullstack-architect"),
          this.getRole("cyber-defense-analyst"),
          this.getRole("gtm-growth-strategist"),
          this.getRole("sre-devops-lead")
        ].filter(Boolean);
      case "security_audit":
        return [
          this.getRole("cyber-defense-analyst"),
          this.getRole("fullstack-architect"),
          this.getRole("sre-devops-lead")
        ].filter(Boolean);
      case "marketing_campaign":
        return [
          this.getRole("gtm-growth-strategist"),
          this.getRole("seo-aeo-specialist"),
          this.getRole("product-ux-designer")
        ].filter(Boolean);
      default:
        return this.listRoles().slice(0, 3);
    }
  }

  /**
   * Generates comprehensive system prompt directive for a role given a project context.
   */
  generateRoleDirective(roleId, context = {}) {
    const role = this.getRole(roleId);
    if (!role) {
      throw new Error(`Role '${roleId}' not found in AgencyAgentsMatrix.`);
    }

    return [
      `=== ULTRON SPECIALIZED AGENT ROLE: ${role.title} ===`,
      `Domain: ${role.domain} | Upstream Reference: ${role.upstreamRole}`,
      `Primary Mapped Agent: ${role.mappedUltronAgent}`,
      `Review Gate: ${role.requiredReviewGate}`,
      ``,
      `DIRECTIVE:`,
      role.systemDirective,
      ``,
      `CORE RESPONSIBILITIES:`,
      ...role.responsibilities.map(r => `* ${r}`),
      ``,
      `ALLOWLISTED TOOLS:`,
      `[${role.allowlistedTools.join(", ")}]`,
      ``,
      `ACTIVE PROJECT CONTEXT:`,
      JSON.stringify(context, null, 2)
    ].join("\n");
  }
}

export const agencyAgentsMatrix = new AgencyAgentsMatrix();
