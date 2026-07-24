import {randomUUID} from "node:crypto";
import {extractMailboxCodeFromRaw} from "../mailbox-url.js";

export interface RemailConfigSource {
    remailApiBaseUrl?: unknown;
    remailApiKey?: unknown;
    remailEnabled?: unknown;
    remailProjectId?: unknown;
    remailProductId?: unknown;
    remailEmailSuffix?: unknown;
    remailSupply?: unknown;
    remailProjectSearch?: unknown;
    remailRequestTimeoutMs?: unknown;
}

export interface RemailMailbox {
    email: string;
    token: string;
    orderNo: string;
    mailboxUrl: string;
}

export interface RemailMessage {
    code: string;
    raw: unknown;
}

interface RemailConfig {
    apiBaseUrl: string;
    apiKey: string;
    projectId: number;
    productId: number;
    emailSuffix: string;
    supply: string;
    projectSearch: string;
    requestTimeoutMs: number;
}

function asString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const text = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(text)) return true;
        if (["0", "false", "no", "off"].includes(text)) return false;
    }
    return fallback;
}

export function isRemailEnabled(source: RemailConfigSource): boolean {
    return asBoolean(source.remailEnabled);
}

function normalizeConfig(source: RemailConfigSource): RemailConfig {
    const apiBaseUrl = asString(source.remailApiBaseUrl, "https://remail.aishop6.com").replace(/\/+$/g, "");
    const apiKey = asString(source.remailApiKey);
    const emailSuffix = asString(source.remailEmailSuffix, "outlook.com").toLowerCase();
    if (!apiKey) throw new Error("remail 已启用，但缺少 remailApiKey");
    if (!["outlook.com", "hotmail.com"].includes(emailSuffix)) {
        throw new Error("remailEmailSuffix 目前只支持 outlook.com 或 hotmail.com");
    }
    return {
        apiBaseUrl,
        apiKey,
        projectId: asNumber(source.remailProjectId),
        productId: asNumber(source.remailProductId),
        emailSuffix,
        supply: asString(source.remailSupply, "public_only") || "public_only",
        projectSearch: asString(source.remailProjectSearch, "OpenAI") || "OpenAI",
        requestTimeoutMs: Math.max(5000, Math.min(300000, asNumber(source.remailRequestTimeoutMs, 30000))),
    };
}

async function requestJson(config: RemailConfig, path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
        const res = await fetch(`${config.apiBaseUrl}${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
                Accept: "application/json",
                ...(init.body ? {"Content-Type": "application/json"} : {}),
                Authorization: `Bearer ${config.apiKey}`,
                ...(init.headers ?? {}),
            },
        });
        const raw = await res.text();
        let data: unknown = raw;
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            // Keep raw body for diagnostics.
        }
        if (!res.ok) {
            const message = typeof data === "object" && data && "message" in data
                ? String((data as {message?: unknown}).message)
                : raw.slice(0, 300);
            throw new Error(`remail HTTP ${res.status}: ${message}`);
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

function pickAutoProjectProduct(payload: unknown, suffix: string): {projectId: number; productId: number} | undefined {
    const items = Array.isArray((payload as {items?: unknown})?.items) ? (payload as {items: unknown[]}).items : [];
    for (const item of items) {
        const project = item as Record<string, unknown>;
        const projectId = asNumber(project.id);
        const products = Array.isArray(project.products) ? project.products : [];
        for (const product of products) {
            const p = product as Record<string, unknown>;
            if (asString(p.type) !== "microsoft") continue;
            if (asString(p.status) !== "enabled") continue;
            if (p.codeEnabled === false) continue;
            const productId = asNumber(p.id);
            const suffixes = Array.isArray(p.suffixes) ? p.suffixes : [];
            const okSuffix = suffixes.some((entry) => {
                const s = entry as Record<string, unknown>;
                return asString(s.suffix).toLowerCase() === suffix && asNumber(s.publicAvailable, 0) > 0;
            });
            if (projectId && productId && (!suffixes.length || okSuffix)) return {projectId, productId};
        }
    }
    return undefined;
}

async function resolveProjectProduct(config: RemailConfig): Promise<{projectId: number; productId: number}> {
    if (config.projectId && config.productId) return {projectId: config.projectId, productId: config.productId};
    const params = new URLSearchParams({
        limit: "50",
        scope: "visible",
        productType: "microsoft",
        search: config.projectSearch,
    });
    const payload = await requestJson(config, `/v1/open/projects?${params.toString()}`, {method: "GET"});
    const picked = pickAutoProjectProduct(payload, config.emailSuffix);
    if (!picked) {
        throw new Error("remail 未配置 projectId/productId，且自动查找不到可用 OpenAI microsoft 项目；请在 config.json 填 remailProjectId/remailProductId");
    }
    return picked;
}

export async function createRemailMailbox(source: RemailConfigSource, origin: string): Promise<RemailMailbox> {
    const config = normalizeConfig(source);
    const {projectId, productId} = await resolveProjectProduct(config);
    const params = new URLSearchParams({
        serviceMode: "code",
        supply: config.supply,
    });
    const order = await requestJson(config, `/v1/open/orders?${params.toString()}`, {
        method: "POST",
        headers: {"Idempotency-Key": `codex-${Date.now()}-${randomUUID()}`},
        body: JSON.stringify({
            projectId,
            productId,
            emailSuffix: config.emailSuffix,
        }),
    }) as Record<string, unknown>;
    const email = asString(order.deliveryEmail);
    const token = asString(order.serviceToken);
    const orderNo = asString(order.orderNo);
    if (!email || !token) {
        throw new Error(`remail 下单成功但缺少 deliveryEmail/serviceToken: ${JSON.stringify(order).slice(0, 500)}`);
    }
    // Record the direct pickup URL so "email----url" can be reused outside this local project.
    const url = new URL("/v1/pickup", config.apiBaseUrl);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    return {email, token, orderNo, mailboxUrl: url.toString()};
}

export async function fetchLatestRemailMessage(source: RemailConfigSource, email: string, token: string): Promise<RemailMessage> {
    const config = normalizeConfig(source);
    const params = new URLSearchParams({email, token});
    const payload = await requestJson(config, `/v1/pickup?${params.toString()}`, {method: "GET"});
    const code = extractMailboxCodeFromRaw(JSON.stringify(payload));
    return {code, raw: payload};
}
