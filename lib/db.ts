import { Pool } from "pg";
import { buildPoolConfig } from "./dbConfig";

export const pool = new Pool(buildPoolConfig(process.env));
