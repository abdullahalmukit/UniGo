import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

// The Prisma CLI needs a mysql:// URL, but the MariaDB driver only accepts mariadb://.
const driverUrl = new URL(env.DATABASE_URL);
driverUrl.protocol = "mariadb:";

// Fail fast when the database is down (the driver waits 10 s by default).
const timeout = String(env.DATABASE_CONNECT_TIMEOUT_MS);
driverUrl.searchParams.set("connectTimeout", timeout);
driverUrl.searchParams.set("acquireTimeout", timeout);

const adapter = new PrismaMariaDb(driverUrl.toString());

export const prisma = new PrismaClient({ adapter });
