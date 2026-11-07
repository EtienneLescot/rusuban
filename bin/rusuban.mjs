#!/usr/bin/env node
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
console.log(`rusuban ${version}`);
