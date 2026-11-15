export const HIGGSFIELD_MCP_URL = 'https://mcp.higgsfield.ai/mcp';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface RpcResponse {
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

export function parseMcpEvent(data: string, id: number): RpcResponse | null {
  for (const event of data.replace(/\r\n/g, '\n').split('\n\n')) {
    const lines = event.split('\n').filter(line => line.startsWith('data:'));
    if (!lines.length) continue;
    try {
      const message = JSON.parse(lines.map(line => line.slice(5).trimStart()).join('\n')) as RpcResponse;
      if (message.id === id) return message;
    } catch { /* An incomplete event will be read with the next chunk. */ }
  }
  return null;
}

async function readRpcResponse(response: Response, id: number): Promise<RpcResponse> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const message = await response.json() as RpcResponse;
    if (message.id !== id) throw new Error('Réponse MCP Higgsfield inattendue.');
    return message;
  }
  if (!response.body) throw new Error('Réponse vide de Higgsfield.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let data = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      data += decoder.decode(value, { stream: !done });
      if (data.length > 12_000_000) throw new Error('La réponse de Higgsfield est trop volumineuse.');
      const message = parseMcpEvent(data, id);
      if (message) return message;
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => undefined); }
  throw new Error('Réponse MCP Higgsfield incomplète.');
}

export function unwrapMcpResult<T>(result: unknown): T {
  if (!result || typeof result !== 'object') throw new Error('Réponse Higgsfield invalide.');
  const value = result as { isError?: boolean; structuredContent?: T; content?: Array<{ type: string; text?: string }> };
  const text = value.content?.filter(part => part.type === 'text').map(part => part.text || '').join('\n');
  if (value.isError) throw new Error(text || 'Higgsfield a refusé cette opération.');
  if (value.structuredContent !== undefined) return value.structuredContent;
  if (text) {
    try { return JSON.parse(text) as T; } catch { throw new Error('Le format de réponse Higgsfield a changé.'); }
  }
  throw new Error('Higgsfield a renvoyé une réponse vide.');
}

export class HiggsfieldMcpClient {
  private id = 0;
  private sessionId: string | null = null;
  private protocol = '2025-06-18';
  private initializing: Promise<void> | null = null;

  constructor(private readonly token: (forceRefresh?: boolean) => Promise<string>, private readonly fetcher: typeof fetch = fetch) {}

  private async post(method: string, params: unknown, notification = false): Promise<unknown> {
    const id = ++this.id;
    const accessToken = await this.token();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await this.fetcher(HIGGSFIELD_MCP_URL, {
        method: 'POST', signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          ...(method !== 'initialize' ? { 'MCP-Protocol-Version': this.protocol } : {}),
          ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
      });
      if (response.status === 401) {
        this.initializing = null;
        throw new Error('Ta connexion Higgsfield a expiré. Reconnecte ton compte.');
      }
      if (response.status === 404 && this.sessionId) {
        this.sessionId = null;
        this.initializing = null;
        throw new Error('La session Higgsfield a expiré. Actualise pour réessayer.');
      }
      if (!response.ok) throw new Error(`Higgsfield est indisponible (${response.status}). Réessaie plus tard.`);
      const session = response.headers.get('Mcp-Session-Id');
      if (session) this.sessionId = session;
      if (notification) { await response.body?.cancel(); return undefined; }
      const message = await readRpcResponse(response, id);
      if (message.error) throw new Error(message.error.message || 'Erreur MCP Higgsfield.');
      return message.result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Higgsfield met trop de temps à répondre. Vérifie tes générations avant de relancer.');
      throw error;
    } finally { clearTimeout(timeout); }
  }

  async initialize() {
    if (!this.initializing) {
      this.initializing = (async () => {
        const result = await this.post('initialize', {
          protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'Scaylit', version: '1.0.0' },
        }) as { protocolVersion?: string };
        if (result.protocolVersion) this.protocol = result.protocolVersion;
        await this.post('notifications/initialized', {}, true);
      })().catch(error => { this.initializing = null; throw error; });
    }
    return this.initializing;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.post('tools/list', cursor ? { cursor } : {}) as { tools: McpTool[]; nextCursor?: string };
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    await this.initialize();
    return unwrapMcpResult<T>(await this.post('tools/call', { name, arguments: args }));
  }
}
