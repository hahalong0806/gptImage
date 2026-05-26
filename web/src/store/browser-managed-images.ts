import localforage from "localforage";

import type { ManagedImage } from "@/lib/api";
import {
  listImageConversations,
  saveImageConversations,
  type ImageConversation,
  type ImageTurn,
  type StoredImage,
} from "@/store/image-conversations";

type BrowserImageFilters = {
  start_date?: string;
  end_date?: string;
};

type BrowserTagMap = Record<string, string[]>;

const browserImageTagStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "browser_image_tags",
});

const BROWSER_IMAGE_TAGS_KEY = "items";
const BROWSER_IMAGE_CLEAR_TOKEN_KEY = "browser_image_clear_token";
const DELETED_IMAGE_ERROR = "生成结果已删除";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function readClearTokenFromLocalStorage() {
  if (typeof window === "undefined") {
    return "";
  }
  return String(window.localStorage.getItem(BROWSER_IMAGE_CLEAR_TOKEN_KEY) || "").trim();
}

function writeClearTokenToLocalStorage(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  const normalizedToken = String(token || "").trim();
  if (normalizedToken) {
    window.localStorage.setItem(BROWSER_IMAGE_CLEAR_TOKEN_KEY, normalizedToken);
    return;
  }
  window.localStorage.removeItem(BROWSER_IMAGE_CLEAR_TOKEN_KEY);
}

function normalizeTagMap(value: unknown): BrowserTagMap {
  if (!value || typeof value !== "object") {
    return {};
  }
  const source = value as Record<string, unknown>;
  const next: BrowserTagMap = {};
  for (const [key, tags] of Object.entries(source)) {
    if (!Array.isArray(tags)) {
      continue;
    }
    const cleaned = tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean);
    if (cleaned.length > 0) {
      next[key] = Array.from(new Set(cleaned));
    }
  }
  return next;
}

async function readBrowserTagMap() {
  return normalizeTagMap(await browserImageTagStorage.getItem<BrowserTagMap>(BROWSER_IMAGE_TAGS_KEY));
}

async function writeBrowserTagMap(tagMap: BrowserTagMap) {
  await browserImageTagStorage.setItem(BROWSER_IMAGE_TAGS_KEY, tagMap);
}

async function getAppliedBrowserClearToken() {
  const localStorageToken = readClearTokenFromLocalStorage();
  if (localStorageToken) {
    return localStorageToken;
  }
  const value = await browserImageTagStorage.getItem<string>(BROWSER_IMAGE_CLEAR_TOKEN_KEY);
  const normalizedToken = String(value || "").trim();
  if (normalizedToken) {
    writeClearTokenToLocalStorage(normalizedToken);
  }
  return normalizedToken;
}

async function setAppliedBrowserClearToken(token: string) {
  const normalizedToken = String(token || "").trim();
  writeClearTokenToLocalStorage(normalizedToken);
  if (normalizedToken) {
    await browserImageTagStorage.setItem(BROWSER_IMAGE_CLEAR_TOKEN_KEY, normalizedToken);
    return;
  }
  await browserImageTagStorage.removeItem(BROWSER_IMAGE_CLEAR_TOKEN_KEY);
}

function managedImageRel(conversationId: string, turnId: string, imageId: string) {
  return `${conversationId}::${turnId}::${imageId}`;
}

function splitManagedImageRel(rel: string) {
  const [conversationId = "", turnId = "", imageId = ""] = String(rel || "").split("::", 3);
  return { conversationId, turnId, imageId };
}

function base64Size(base64: string) {
  const normalized = base64.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function imageDate(createdAt: string) {
  return String(createdAt || "").slice(0, 10);
}

function timestampOf(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getStoredImageDataUrl(image: StoredImage) {
  if (image.b64_json) {
    return `data:image/png;base64,${image.b64_json}`;
  }
  if (typeof image.url === "string" && image.url.startsWith("data:image/")) {
    return image.url;
  }
  return "";
}

function deriveTurnStatus(turn: ImageTurn): Pick<ImageTurn, "status" | "error"> {
  const loadingCount = turn.images.filter((image) => image.status === "loading").length;
  const successCount = turn.images.filter((image) => image.status === "success").length;
  const errorCount = turn.images.filter((image) => image.status === "error").length;
  if (loadingCount > 0) {
    return { status: turn.status === "queued" ? "queued" : "generating", error: undefined };
  }
  if (successCount > 0) {
    return { status: "success", error: undefined };
  }
  if (errorCount > 0) {
    return { status: "error", error: turn.error || `其中 ${errorCount} 张未成功生成` };
  }
  return { status: "queued", error: undefined };
}

function buildManagedImage(
  conversation: ImageConversation,
  turn: ImageTurn,
  image: StoredImage,
  index: number,
  tagMap: BrowserTagMap,
): ManagedImage | null {
  if (turn.resultsDeleted || image.status !== "success") {
    return null;
  }
  const src = getStoredImageDataUrl(image);
  if (!src) {
    return null;
  }
  const rel = managedImageRel(conversation.id, turn.id, image.id);
  const extension = src.startsWith("data:image/jpeg") ? "jpg" : src.startsWith("data:image/webp") ? "webp" : "png";
  const createdAt = turn.createdAt || conversation.updatedAt || conversation.createdAt || new Date().toISOString();
  const byteSize = image.b64_json ? base64Size(image.b64_json) : 0;
  return {
    rel,
    name: `${conversation.title || "image"}-${index + 1}.${extension}`.replace(/[\\/:*?"<>|]+/g, "-"),
    date: imageDate(createdAt),
    size: byteSize,
    url: src,
    thumbnail_url: src,
    created_at: createdAt,
    storage: "browser",
    local: false,
    webdav: false,
    tags: tagMap[rel] || [],
  };
}

async function collectManagedImages(filters: BrowserImageFilters = {}) {
  const [conversations, tagMap] = await Promise.all([listImageConversations(), readBrowserTagMap()]);
  const items = conversations.flatMap((conversation) =>
    conversation.turns.flatMap((turn) => {
      const createdDay = imageDate(turn.createdAt);
      if (filters.start_date && createdDay < filters.start_date) {
        return [];
      }
      if (filters.end_date && createdDay > filters.end_date) {
        return [];
      }
      return turn.images.flatMap((image, index) => {
        const managed = buildManagedImage(conversation, turn, image, index, tagMap);
        return managed ? [managed] : [];
      });
    }),
  );
  items.sort((left, right) => right.created_at.localeCompare(left.created_at));
  return { conversations, items, tagMap };
}

async function pruneBrowserTags(validRels: Set<string>) {
  const tagMap = await readBrowserTagMap();
  const next: BrowserTagMap = {};
  let changed = false;
  for (const [rel, tags] of Object.entries(tagMap)) {
    if (validRels.has(rel)) {
      next[rel] = tags;
      continue;
    }
    changed = true;
  }
  if (changed) {
    await writeBrowserTagMap(next);
  }
}

export async function listBrowserManagedImages(filters: BrowserImageFilters = {}) {
  const { items } = await collectManagedImages(filters);
  await pruneBrowserTags(new Set(items.map((item) => item.rel)));
  const groups = items.reduce<Array<{ date: string; items: ManagedImage[] }>>((acc, item) => {
    const current = acc.find((group) => group.date === item.date);
    if (current) {
      current.items.push(item);
    } else {
      acc.push({ date: item.date, items: [item] });
    }
    return acc;
  }, []);
  return { items, groups };
}

export async function fetchBrowserImageTags() {
  const { items, tagMap } = await collectManagedImages();
  const validRels = new Set(items.map((item) => item.rel));
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const rel of Object.keys(tagMap)) {
    if (!validRels.has(rel)) {
      continue;
    }
    for (const tag of tagMap[rel] || []) {
      if (seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      tags.push(tag);
    }
  }
  return { tags };
}

export async function setBrowserImageTags(rel: string, tags: string[]) {
  const cleaned = Array.from(new Set(tags.map((tag) => String(tag || "").trim()).filter(Boolean)));
  const tagMap = await readBrowserTagMap();
  if (cleaned.length > 0) {
    tagMap[rel] = cleaned;
  } else {
    delete tagMap[rel];
  }
  await writeBrowserTagMap(tagMap);
  return { ok: true, tags: cleaned };
}

export async function deleteBrowserImageTag(tag: string) {
  const target = String(tag || "").trim();
  if (!target) {
    return { ok: true, removed_from: 0 };
  }
  const tagMap = await readBrowserTagMap();
  let removedFrom = 0;
  for (const rel of Object.keys(tagMap)) {
    if (!tagMap[rel]?.includes(target)) {
      continue;
    }
    const nextTags = tagMap[rel].filter((item) => item !== target);
    if (nextTags.length > 0) {
      tagMap[rel] = nextTags;
    } else {
      delete tagMap[rel];
    }
    removedFrom += 1;
  }
  await writeBrowserTagMap(tagMap);
  return { ok: true, removed_from: removedFrom };
}

async function writeDeletedImages(targetRels: Set<string>) {
  const conversations = await listImageConversations();
  let changed = false;
  const nextConversations = conversations
    .map((conversation) => {
      let conversationChanged = false;
      const turns = conversation.turns
        .map((turn) => {
          let turnChanged = false;
          const images = turn.images.map((image) => {
            const rel = managedImageRel(conversation.id, turn.id, image.id);
            if (!targetRels.has(rel) || image.status !== "success") {
              return image;
            }
            turnChanged = true;
            return {
              id: image.id,
              status: "error" as const,
              error: DELETED_IMAGE_ERROR,
            };
          });
          if (!turnChanged) {
            return turn;
          }
          conversationChanged = true;
          const allDeleted = images.length > 0 && images.every(
            (image) => image.status === "error" && image.error === DELETED_IMAGE_ERROR,
          );
          return {
            ...turn,
            ...deriveTurnStatus({ ...turn, images }),
            resultsDeleted: allDeleted,
            images,
          };
        })
        .filter(Boolean);
      if (!conversationChanged) {
        return conversation;
      }
      changed = true;
      return {
        ...conversation,
        updatedAt: new Date().toISOString(),
        turns,
      };
    })
    .filter((conversation) => conversation.turns.length > 0);
  if (changed) {
    await saveImageConversations(nextConversations);
  }
  return changed;
}

async function removeBrowserManagedImages(targetRels: Set<string>) {
  if (targetRels.size === 0) {
    return { removed: 0 };
  }
  await writeDeletedImages(targetRels);
  const tagMap = await readBrowserTagMap();
  let tagChanged = false;
  for (const rel of targetRels) {
    if (!(rel in tagMap)) {
      continue;
    }
    delete tagMap[rel];
    tagChanged = true;
  }
  if (tagChanged) {
    await writeBrowserTagMap(tagMap);
  }
  return { removed: targetRels.size };
}

export async function deleteBrowserManagedImages(body: {
  paths?: string[];
  start_date?: string;
  end_date?: string;
  all_matching?: boolean;
}) {
  const items = (await listBrowserManagedImages({
    start_date: body.start_date,
    end_date: body.end_date,
  })).items;
  const targets = body.all_matching
    ? items.map((item) => item.rel)
    : (body.paths || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (targets.length === 0) {
    return { removed: 0 };
  }
  return removeBrowserManagedImages(new Set(targets));
}

export async function pruneExpiredBrowserManagedImages(retentionDays: number) {
  const normalizedRetentionDays = Math.max(1, Number(retentionDays) || 0);
  const cutoffTimestamp = Date.now() - normalizedRetentionDays * DAY_IN_MS;
  const { items } = await collectManagedImages();
  const expiredRels = items
    .filter((item) => timestampOf(item.created_at) < cutoffTimestamp)
    .map((item) => item.rel);
  if (expiredRels.length === 0) {
    return { removed: 0 };
  }
  return removeBrowserManagedImages(new Set(expiredRels));
}

function dataUrlToBlob(dataUrl: string) {
  const [header, content] = dataUrl.split(",", 2);
  const mimeType = header.match(/data:(.*?);base64/i)?.[1] || "image/png";
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function downloadManagedItem(item: ManagedImage) {
  const blob = dataUrlToBlob(item.url);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = item.name || "image.png";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function downloadBrowserManagedImage(rel: string) {
  const item = (await listBrowserManagedImages()).items.find((candidate) => candidate.rel === rel);
  if (!item) {
    throw new Error("图片不存在或已删除");
  }
  await downloadManagedItem(item);
}

export async function downloadBrowserManagedImages(paths: string[]) {
  const targets = new Set(paths.map((item) => String(item || "").trim()).filter(Boolean));
  const items = (await listBrowserManagedImages()).items.filter((item) => targets.has(item.rel));
  for (const item of items) {
    await downloadManagedItem(item);
  }
  return { downloaded: items.length };
}

export async function clearBrowserManagedImages() {
  const items = (await listBrowserManagedImages()).items;
  if (items.length === 0) {
    await writeBrowserTagMap({});
    return { removed: 0 };
  }
  await deleteBrowserManagedImages({ paths: items.map((item) => item.rel) });
  await writeBrowserTagMap({});
  return { removed: items.length };
}

export function isBrowserManagedImage(item: ManagedImage) {
  return item.storage === "browser";
}

export function isDeletedBrowserManagedImage(image: StoredImage) {
  return image.status === "error" && image.error === DELETED_IMAGE_ERROR;
}

export function getBrowserManagedImageRel(conversationId: string, turnId: string, imageId: string) {
  return managedImageRel(conversationId, turnId, imageId);
}

export function getBrowserManagedImageSourceIds(rel: string) {
  return splitManagedImageRel(rel);
}

export async function syncBrowserImageClearSignal(token: string) {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return { applied: false, removed: 0 };
  }
  const currentToken = await getAppliedBrowserClearToken();
  if (currentToken === normalizedToken) {
    return { applied: false, removed: 0 };
  }
  const result = await clearBrowserManagedImages();
  await setAppliedBrowserClearToken(normalizedToken);
  return { applied: true, removed: result.removed };
}
