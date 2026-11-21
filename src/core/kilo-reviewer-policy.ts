/** A restrictive Kilo reviewer configuration fragment for a future standalone
 * model-only process. KILO_CONFIG_CONTENT is supported by the Kilo CLI and has
 * higher priority than ordinary project-level agent configuration.
 *
 * IMPORTANT: A permission configuration is NOT an OS sandbox, data-confidentiality
 * boundary, or proof that plugins and managed/organization config are disabled.
 * The trusted controller must run Kilo in a separately isolated process whose
 * project directory, home, credentials, runtime sockets and network are restricted.
 * No caller is allowed to use this fragment to authorize a production reviewer.
 */

const AGENT_NAME = 'autodev-reviewer';
const MODEL_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/:+-]{1,160}$/;
const DENIED_TOOLS = ['bash','edit','read','glob','grep','webfetch','websearch',
  'task','todowrite','lsp','skill','external_directory'] as const;

export interface NoToolsReviewerPolicy {
  configContent: string;
  agent: typeof AGENT_NAME;
}
export function createNoToolsReviewerPolicy(model: string): NoToolsReviewerPolicy {
  if (!MODEL_PATTERN.test(model)) throw new Error('Invalid reviewer model identifier');
  const permission: Record<string,'deny'> = {'*':'deny'};
  for (const tool of DENIED_TOOLS) permission[tool]='deny';
  const config = {
    '$schema':'https://app.kilo.ai/config.json',
    model,
    permission,
    agent: {
      [AGENT_NAME]: {
        description: 'Model-only independent reviewer. No tool or filesystem access.',
        mode:'primary',
        model,
        permission: {...permission},
      },
    },
    // These settings reduce unnecessary tool/plugin startup, but do NOT
    // override arbitrary globally installed integrations or managed policy.
    formatter:false,
    lsp:false,
  };
  return {configContent:JSON.stringify(config),agent:AGENT_NAME};
}

/** Never derive these environment values from the repository or an issue.
 * This is not a complete spawn environment: the caller must create an
 * OS-isolated, credential-minimized process before using it.
 */
export function assertNoToolsReviewerPolicy(content: string): void {
  let raw: unknown;
  try { raw=JSON.parse(content); }
  catch { throw new Error('Invalid reviewer policy JSON'); }
  if (!raw || typeof raw!=='object' || Array.isArray(raw))
    throw new Error('Invalid reviewer policy');
  const config=raw as Record<string,unknown>;
  const tools=config.permission as Record<string,unknown> | undefined;
  const agentConfig=(config.agent as Record<string,unknown> | undefined)?.[AGENT_NAME] as Record<string,unknown> | undefined;
  const agentPermissions=agentConfig?.permission as Record<string,unknown> | undefined;
  if (!tools || !agentPermissions ||
      !['*',...DENIED_TOOLS].every(name=>tools[name]==='deny' && agentPermissions[name]==='deny')) {
    throw new Error('Reviewer policy does not deny all tools');
  }
  if (config.formatter!==false || config.lsp!==false || agentConfig?.mode!=='primary')
    throw new Error('Unexpected reviewer process capabilities');
}
