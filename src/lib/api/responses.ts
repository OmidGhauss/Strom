export type ListMeta = {
  count: number;
  page: number;
  pageSize: number;
};

export function singleResponse<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

export function listResponse<T>(
  data: T[],
  meta: ListMeta,
  status = 200
): Response {
  return Response.json({ data, ...meta }, { status });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}
