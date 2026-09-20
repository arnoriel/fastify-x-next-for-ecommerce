import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "../lib/db";
import * as schema from "./schema";

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export { schema };
