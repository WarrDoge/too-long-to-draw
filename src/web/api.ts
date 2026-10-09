import { Diagram } from "../core/model";

export type DiagramInfo = { name: string; modified: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const url = (name: string) => `/api/diagrams/${encodeURIComponent(name)}`;

async function call(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return res;
}

const json = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function listDiagrams(): Promise<DiagramInfo[]> {
  return (await (await call("/api/diagrams")).json()) as DiagramInfo[];
}

export async function loadDiagram(name: string): Promise<{ diagram: Diagram; etag: string }> {
  const res = await call(url(name));
  return { diagram: Diagram.parse(await res.json()), etag: res.headers.get("ETag") ?? "" };
}

export async function saveDiagram(
  name: string,
  diagram: Diagram,
  pre: { ifMatch: string } | { ifNoneMatch: true } | null,
  opts: { keepalive?: boolean } = {},
): Promise<string> {
  const init = json(diagram);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (pre && "ifMatch" in pre) headers["If-Match"] = pre.ifMatch;
  if (pre && "ifNoneMatch" in pre) headers["If-None-Match"] = "*";
  const res = await call(url(name), { ...init, method: "PUT", headers, keepalive: opts.keepalive });
  return res.headers.get("ETag") ?? "";
}

export async function renameDiagram(from: string, to: string): Promise<void> {
  await call(`${url(from)}/rename`, { ...json({ name: to }), method: "POST" });
}

export async function deleteDiagram(name: string): Promise<void> {
  await call(url(name), { method: "DELETE" });
}
