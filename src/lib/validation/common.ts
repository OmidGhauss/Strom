import * as z from "zod";

export const UuidSchema = z.string().uuid("Ungültige UUID");

export const PaginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().int().min(1)),
  pageSize: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
});

export type PaginationParams = z.infer<typeof PaginationSchema>;

export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const result = PaginationSchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    pageSize: searchParams.get("pageSize") ?? undefined,
  });
  if (!result.success) {
    return { page: 1, pageSize: 20 };
  }
  return result.data;
}

export function paginationRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { from, to };
}
