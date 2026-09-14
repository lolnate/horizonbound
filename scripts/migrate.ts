import { config as loadEnvironment } from "dotenv";
import path from "node:path";
import { loadRuntimeConfig } from "../src/config/runtime";
import { openDatabase } from "../src/db/database";

loadEnvironment({ quiet: true });
const config = loadRuntimeConfig(process.env);
const database = openDatabase(path.join(config.stateDirectory, "horizonbound.sqlite"));
console.log(`Applied ${database.schemaVersion()} Horizonbound migration(s).`);
database.close();
