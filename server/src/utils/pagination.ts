import type { PaginationMeta } from '@/utils/apiResponse';

export interface PageRequest {
  page: number;
  limit: number;
}

export function toSkip({ page, limit }: PageRequest): number {
  return (page - 1) * limit;
}

/** Builds the `meta` block every paginated list response carries. */
export function buildPaginationMeta(total: number, { page, limit }: PageRequest): PaginationMeta {
  return { total, page, limit, totalPages: Math.ceil(total / limit) };
}
