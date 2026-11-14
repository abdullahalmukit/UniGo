import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../../../data");
const FILE_PATH = path.join(DATA_DIR, "custom-categories.json");

export type CustomCategory = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
};

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify([]), "utf-8");
  }
}

export function readCustomCategories(): CustomCategory[] {
  try {
    ensureFile();
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    return JSON.parse(raw) as CustomCategory[];
  } catch {
    return [];
  }
}

export function writeCustomCategories(categories: CustomCategory[]): void {
  ensureFile();
  fs.writeFileSync(FILE_PATH, JSON.stringify(categories, null, 2), "utf-8");
}

export function addCustomCategory(name: string, sortOrder = 10): CustomCategory {
  const trimmed = name.trim();
  const slug = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `CUSTOM_${Date.now().toString().slice(-6)}`;

  const current = readCustomCategories();
  const exists = current.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (exists) {
    if (!exists.isActive) {
      exists.isActive = true;
      writeCustomCategories(current);
    }
    return exists;
  }

  const newCat: CustomCategory = {
    id: `custom-cat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    code: slug,
    name: trimmed,
    sortOrder: sortOrder || (current.length > 0 ? Math.max(...current.map((c) => c.sortOrder)) + 1 : 10),
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  current.push(newCat);
  writeCustomCategories(current);
  return newCat;
}

export function deleteCustomCategory(id: string): boolean {
  const current = readCustomCategories();
  const index = current.findIndex((c) => c.id === id);
  if (index === -1) return false;
  current.splice(index, 1);
  writeCustomCategories(current);
  return true;
}

