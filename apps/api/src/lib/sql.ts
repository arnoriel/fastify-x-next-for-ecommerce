/** Escape wildcard LIKE supaya input user dicari secara literal. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Offset SQL untuk halaman 1-based. */
export const pageOffset = (page: number, pageSize: number) => (page - 1) * pageSize;
