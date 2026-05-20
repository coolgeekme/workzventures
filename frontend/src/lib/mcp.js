/**
 * WebMCP shim — exposes platform actions for AI agents (Claude in Chrome, LangChain, Hermes)
 * via navigator.mcpActions.register() and corresponding data-mcp-action DOM attributes.
 */
import { api } from "./api";

const LOCAL_ACTIONS = [
  {
    id: "research.company.summarize",
    description: "Generate AI research summary for any company.",
    handler: async ({ company_name, sector, region, notes }) => {
      const r = await api.post("/research/company", { company_name, sector, region, notes });
      return r.data;
    },
  },
  {
    id: "collateral.generate",
    description: "Generate marketing collateral (one-pager, email, LinkedIn post, deal memo).",
    handler: async (p) => (await api.post("/collateral/generate", p)).data,
  },
  {
    id: "outreach.campaign.create",
    description: "Create personalized outreach campaign on LinkedIn or email.",
    handler: async (p) => (await api.post("/outreach/campaigns", p)).data,
  },
  {
    id: "leads.list",
    description: "List all leads in nurturing pipeline.",
    handler: async () => (await api.get("/leads")).data,
  },
  {
    id: "leads.advance",
    description: "Advance lead to next stage.",
    handler: async ({ lead_id, stage }) =>
      (await api.patch(`/leads/${lead_id}/stage`, { stage })).data,
  },
  {
    id: "newsletter.draft",
    description: "AI-draft a personalized newsletter.",
    handler: async ({ topic } = {}) => (await api.post("/newsletter/draft", { topic })).data,
  },
  {
    id: "newsletter.dispatch",
    description: "Dispatch a newsletter (mocked email delivery).",
    handler: async ({ id }) => (await api.post(`/newsletter/${id}/dispatch`)).data,
  },
  {
    id: "composio.linkedin.connect",
    description: "Initiate LinkedIn OAuth via Composio.",
    handler: async () => (await api.post("/composio/connect/linkedin")).data,
  },
  {
    id: "dashboard.kpis",
    description: "Read top-level platform KPIs.",
    handler: async () => (await api.get("/dashboard/stats")).data,
  },
];

let registered = false;

export function installMCP() {
  if (registered) return;
  registered = true;

  if (typeof navigator !== "undefined") {
    if (!navigator.mcpActions) {
      navigator.mcpActions = {
        _store: new Map(),
        register(action) {
          this._store.set(action.id, action);
          window.dispatchEvent(new CustomEvent("mcp:registered", { detail: action.id }));
        },
        list() {
          return Array.from(this._store.values()).map((a) => ({
            id: a.id,
            description: a.description,
          }));
        },
        async invoke(id, params) {
          const a = this._store.get(id);
          if (!a) throw new Error(`MCP action ${id} not found`);
          return await a.handler(params || {});
        },
      };
    }
    LOCAL_ACTIONS.forEach((a) => navigator.mcpActions.register(a));
  }
}

export function listLocalActions() {
  return LOCAL_ACTIONS.map((a) => ({ id: a.id, description: a.description }));
}
