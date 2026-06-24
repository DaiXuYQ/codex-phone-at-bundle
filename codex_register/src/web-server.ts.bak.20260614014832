import http, {type IncomingMessage, type ServerResponse} from "node:http";
import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {existsSync, readFileSync} from "node:fs";
import {appendFile, mkdir, readFile, rename, unlink, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Agent, ProxyAgent, type Dispatcher} from "undici";
import {DEFAULT_CLIENT_ID, DEFAULT_REDIRECT_URI, DEFAULT_USER_AGENT} from "./constants.js";
import {createHeroSmsProvider} from "./sms/heroSMS.js";
import type {SmsProvider} from "./sms/provider.js";
import {createSmsBowerProvider} from "./sms/smsbower.js";
type TaskStatus = "queued" | "running" | "success" | "failed" | "canceled";
type EditableSmsProvider = "hero-sms" | "smsbower";
type TaskKind = "register" | "oa-sub2api";
type OaEmailBindStatus = "free" | "reserved" | "bound" | "failed" | "canceled" | "disabled";

interface RegisterTask {
    id: string;
    kind: TaskKind;
    status: TaskStatus;
    title: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    exitCode?: number | null;
    signal?: string | null;
    args: string[];
    tokenOut: string;
    phone?: string;
    phoneProvider?: string;
    phoneActivationId?: string;
    phoneActivationAt?: string;
    smsCost?: number;
    smsCostCurrency?: string;
    smsCancelRequestedAt?: string;
    smsCanceledAt?: string;
    smsCancelResult?: string;
    smsCancelError?: string;
    bindEmail?: string;
    mailboxUrl?: string;
    emailRaw?: string;
    oaProxyUrl?: string;
    sub2apiAccount?: string;
    sub2apiGroup?: string;
    sourceAccessTokenHash?: string;
    accessTokenHash?: string;
    accessTokenPreview?: string;
    successTextFile?: string;
    error?: string;
    logs: string[];
}

interface RuntimeRegisterTask extends RegisterTask {
    child?: ChildProcessWithoutNullStreams;
    env?: NodeJS.ProcessEnv;
}

interface OaEmailPoolItem {
    index: number;
    email: string;
    mailboxUrl: string;
    raw: string;
    kind: "url" | "hotmail";
    preview: string;
    available: boolean;
    assignedTaskId?: string;
    assignedTaskStatus?: TaskStatus;
    assignedPhone?: string;
    bindStatus: OaEmailBindStatus;
    bindPhone?: string;
    bindTaskId?: string;
    bindSub2ApiAccount?: string;
    bindAccessTokenHash?: string;
    bindError?: string;
    bindUpdatedAt?: string;
    bindNote?: string;
}

interface OaEmailStatusRecord {
    email: string;
    status: OaEmailBindStatus;
    phone?: string;
    taskId?: string;
    sub2apiAccount?: string;
    accessTokenHash?: string;
    error?: string;
    note?: string;
    updatedAt: string;
}

interface OaEmailStatusStore {
    emails: Record<string, OaEmailStatusRecord>;
}

interface TrialResult {
    checkedAt: string;
    ok: boolean;
    status?: string;
    eligible?: boolean;
    result_code?: string;
    message?: string;
    amount_cents?: number;
    currency?: string;
    raw?: unknown;
    error?: string;
}

interface AtMetaStore {
    trial: Record<string, TrialResult>;
    oa: Record<string, AtOaRecord>;
}

interface AtOaRecord {
    enabled?: boolean | null;
    note?: string;
    updatedAt: string;
}

interface PlusJobRecord {
    localId: string;
    jobId: string;
    status: string;
    clientRef: string;
    tokenHash?: string;
    tokenPreview?: string;
    tokenPhone?: string;
    tokenEmail?: string;
    paypalPhone: string;
    request: Record<string, unknown>;
    response?: unknown;
    latest?: unknown;
    resultCode?: string;
    errorMessage?: string;
    billingStatus?: string;
    otpPending?: boolean;
    done?: boolean;
    removeTokenOnSuccess?: boolean;
    createdAt: string;
    updatedAt: string;
    error?: string;
}

interface PpxyConfig {
    baseUrl: string;
    apiKey: string;
    proxyJp: string;
    tokenFile: string;
}

interface SmsPriceItem {
    price: number;
    count: number;
    providerIds: string[];
}

interface SmsCountryItem {
    code: number;
    nameZh: string;
    nameEn: string;
}

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(srcDir, "..");
const rootDir = path.resolve(appDir, "..");
const webDir = path.join(appDir, "web");
const configFile = path.join(appDir, "config.json");
const dataDir = path.join(rootDir, ".web-data");
const logDir = path.join(dataDir, "logs");
const tasksFile = path.join(dataDir, "register-tasks.json");
const plusJobsFile = path.join(dataDir, "plus-jobs.json");
const atMetaFile = path.join(dataDir, "at-meta.json");
const oaEmailPoolFile = path.join(dataDir, "oa-email-pool.txt");
const oaEmailStatusFile = path.join(dataDir, "oa-email-status.json");
const agentQuickDocFile = path.join(rootDir, "AGENT-QUICK-UNDERSTANDING.md");
const agentFullDocFile = path.join(rootDir, "AGENT-INTEGRATION.md");

const registerTasks = new Map<string, RuntimeRegisterTask>();
const plusJobs = new Map<string, PlusJobRecord>();
const pollingPlusJobs = new Set<string>();
const smsCancelInFlight = new Set<string>();
let registerQueue: RuntimeRegisterTask[] = [];
let registerRunning = 0;
let registerMaxConcurrency = 1;
let atMeta: AtMetaStore = {trial: {}, oa: {}};
let oaEmailStatus: OaEmailStatusStore = {emails: {}};
const fileWriteQueues = new Map<string, Promise<void>>();

function nowIso(): string {
    return new Date().toISOString();
}

function maskSecret(value: string): string {
    if (!value) return "";
    if (value.length <= 10) return `${value.slice(0, 2)}***`;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function tokenPreview(token: string): string {
    if (token.length <= 24) return token;
    return `${token.slice(0, 12)}...${token.slice(-8)}`;
}

function redactCliArgs(args: string[]): string[] {
    const secretFlags = new Set(["--password", "--sub2api-password", "--mailbox-url", "--email-raw"]);
    const redacted: string[] = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        redacted.push(arg);
        if (secretFlags.has(arg) && i + 1 < args.length) {
            redacted.push("***");
            i += 1;
        }
    }
    return redacted;
}

function safeNumber(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDataDirs(): Promise<void> {
    await mkdir(logDir, {recursive: true});
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch {
        return fallback;
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
        await mkdir(path.dirname(filePath), {recursive: true});
        const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
        await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
        await rename(tmp, filePath);
    });
    fileWriteQueues.set(filePath, current);
    try {
        await current;
    } finally {
        if (fileWriteQueues.get(filePath) === current) {
            fileWriteQueues.delete(filePath);
        }
    }
}

async function loadStores(): Promise<void> {
    await ensureDataDirs();
    oaEmailStatus = await readJsonFile<OaEmailStatusStore>(oaEmailStatusFile, {emails: {}});
    if (!oaEmailStatus || typeof oaEmailStatus !== "object" || !oaEmailStatus.emails) {
        oaEmailStatus = {emails: {}};
    }

    let loadedTasksChanged = false;
    const loadedTasks = await readJsonFile<RegisterTask[]>(tasksFile, []);
    for (const task of loadedTasks) {
        const runtime = normalizeLoadedTask(task);
        if (runtime.status === "running" || runtime.status === "queued") {
            if (taskHasSuccessOutput(runtime)) {
                runtime.status = "success";
                runtime.exitCode = runtime.exitCode ?? 0;
                runtime.error = undefined;
                runtime.finishedAt = runtime.finishedAt ?? nowIso();
                runtime.updatedAt = nowIso();
                appendTaskLog(runtime, "system", "recovered as success: success output was already captured before server restart");
                if (runtime.kind === "oa-sub2api" && runtime.bindEmail) {
                    recordOaTaskEmailStatus(runtime, "bound");
                }
                loadedTasksChanged = true;
            } else {
                runtime.status = "failed";
                runtime.error = "server restarted before task finished";
                runtime.finishedAt = runtime.finishedAt ?? nowIso();
                runtime.updatedAt = nowIso();
                if (runtime.kind === "oa-sub2api" && runtime.bindEmail) {
                    recordOaTaskEmailStatus(runtime, "failed", runtime.error);
                }
                loadedTasksChanged = true;
            }
        }
        registerTasks.set(runtime.id, runtime);
    }
    if (loadedTasksChanged) {
        await saveRegisterTasks();
    }

    const loadedPlusJobs = await readJsonFile<PlusJobRecord[]>(plusJobsFile, []);
    for (const job of loadedPlusJobs) {
        plusJobs.set(job.localId, job);
        if (job.jobId && !job.done) {
            startPlusPolling(job.localId);
        }
    }

    atMeta = await readJsonFile<AtMetaStore>(atMetaFile, {trial: {}, oa: {}});
    if (!atMeta || typeof atMeta !== "object") {
        atMeta = {trial: {}, oa: {}};
    }
    if (!atMeta.trial) {
        atMeta.trial = {};
    }
    if (!atMeta.oa) {
        atMeta.oa = {};
    }
}

async function saveRegisterTasks(): Promise<void> {
    const snapshot = Array.from(registerTasks.values()).map((task) => {
        const {child: _child, env: _env, ...plain} = task;
        return {...plain, logs: plain.logs.slice(-300)};
    });
    await writeJsonFile(tasksFile, snapshot);
}

async function savePlusJobs(): Promise<void> {
    await writeJsonFile(plusJobsFile, Array.from(plusJobs.values()));
}

async function saveAtMeta(): Promise<void> {
    await writeJsonFile(atMetaFile, atMeta);
}

async function saveOaEmailStatus(): Promise<void> {
    await writeJsonFile(oaEmailStatusFile, oaEmailStatus);
}

function saveOaEmailStatusLater(): void {
    void saveOaEmailStatus().catch((error) => {
        console.error(`save oa email status failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function saveRegisterTasksLater(): void {
    void saveRegisterTasks().catch((error) => {
        console.error(`save register tasks failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function savePlusJobsLater(): void {
    void savePlusJobs().catch((error) => {
        console.error(`save plus jobs failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function parseCmdEnvFile(): Record<string, string> {
    const envFile = path.join(rootDir, "ppxy-env.cmd");
    if (!existsSync(envFile)) return {};
    const raw = readFileSync(envFile, "utf8");
    const env: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^\s*set\s+"?([^=\s"]+)=([^"]*)"?\s*$/i);
        if (!match) continue;
        const key = match[1];
        let value = match[2] ?? "";
        value = value.replace(/%~dp0/gi, rootDir.endsWith(path.sep) ? rootDir : `${rootDir}${path.sep}`);
        env[key] = value;
    }
    return env;
}

function getPpxyConfig(): PpxyConfig {
    const cmdEnv = parseCmdEnvFile();
    const baseUrl = String(process.env.PPXY_BASE_URL || cmdEnv.PPXY_BASE_URL || "https://plus.iceaix.com").replace(/\/+$/, "");
    const apiKey = String(process.env.PPXY_API_KEY || cmdEnv.PPXY_API_KEY || "");
    const proxyJp = String(process.env.PPXY_PROXY_JP || cmdEnv.PPXY_PROXY_JP || "");
    const tokenFile = path.resolve(String(process.env.TOKEN_FILE || cmdEnv.TOKEN_FILE || path.join(rootDir, "pool_tokens.txt")));
    return {baseUrl, apiKey, proxyJp, tokenFile};
}

function getMailApiBaseUrl(): string {
    const cmdEnv = parseCmdEnvFile();
    const config = readConfigSync();
    return String(
        process.env.MAIL_API_BASE_URL
        || cmdEnv.MAIL_API_BASE_URL
        || asString(config.mailApiBaseUrl)
        || "",
    ).trim();
}

function getOaProxyUrl(config = readConfigSync()): string {
    for (const key of ["OPENAI_PROXY_URL", "DEFAULT_PROXY_URL"]) {
        if (process.env[key] !== undefined) {
            const value = String(process.env[key] ?? "").trim();
            return value.toLowerCase() === "direct" ? "" : value;
        }
    }
    return asString(config.defaultProxyUrl).trim();
}

function validateMailApiBaseUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    // Validate early so import failures are explicit instead of silently skipping every row.
    new URL(withProtocol);
    return trimmed;
}

function maskUrlSecret(value: string): string {
    if (!value) return "";
    try {
        const url = new URL(value);
        if (url.username) url.username = maskSecret(decodeURIComponent(url.username));
        if (url.password) url.password = "***";
        return url.toString();
    } catch {
        return maskSecret(value);
    }
}

function describeError(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause instanceof Error ? `; cause=${error.cause.message}` : "";
    const code = "code" in error ? `; code=${String((error as {code?: unknown}).code ?? "")}` : "";
    return `${error.name}: ${error.message}${code}${cause}`;
}

function readConfigSync(): Record<string, unknown> {
    try {
        const parsed = JSON.parse(readFileSync(configFile, "utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return parsed as Record<string, unknown>;
    } catch {
        return {};
    }
}

async function readConfigForWrite(): Promise<Record<string, unknown>> {
    const parsed = JSON.parse(await readFile(configFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("config.json must be a JSON object");
    }
    return parsed as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNumberArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function normalizeEditableSmsProvider(value: unknown): EditableSmsProvider {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "smsbower" || normalized === "sms-bower" ? "smsbower" : "hero-sms";
}

function normalizeTaskSmsProvider(value: unknown): EditableSmsProvider {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized.includes("smsbower") || normalized.includes("sms-bower")) return "smsbower";
    if (normalized.includes("hero")) return "hero-sms";
    return normalizeEditableSmsProvider(readConfigSync().smsProvider);
}

function parseNumberList(value: unknown, label: string, options: {integer?: boolean; positive?: boolean} = {}): number[] {
    const rawItems = Array.isArray(value)
        ? value
        : String(value ?? "")
            .split(/[\s,，;；]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    const items = rawItems.map((item) => Number(item));
    if (items.some((item) => !Number.isFinite(item))) {
        throw new Error(`${label} 包含无效数字`);
    }
    const normalized = items.map((item) => options.integer ? Math.floor(item) : item);
    if (options.positive && normalized.some((item) => item <= 0)) {
        throw new Error(`${label} 必须大于 0`);
    }
    if (options.integer && normalized.some((item) => item < 0)) {
        throw new Error(`${label} 必须是非负整数`);
    }
    return Array.from(new Set(normalized));
}

function parseStringList(value: unknown): string[] {
    const rawItems = Array.isArray(value)
        ? value
        : String(value ?? "")
            .split(/[\r\n,;，；]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    return Array.from(new Set(rawItems.map((item) => String(item).trim()).filter(Boolean)));
}

function maxOf(values: number[], fallback: number): number {
    return values.length ? Math.max(...values) : fallback;
}

function getSmsConfigView(config: Record<string, unknown>): Record<string, unknown> {
    const smsProvider = normalizeEditableSmsProvider(config.smsProvider);
    const heroPriceTiers = asNumberArray(config.heroSMSPriceTiers);
    const smsbowerPriceTiers = asNumberArray(config.smsbowerMaxPriceTiers);
    const heroCountries = asNumberArray(config.heroSMSCountries);
    const smsbowerCountries = asNumberArray(config.smsbowerCountries);
    const heroCountry = asNumber(config.heroSMSCountry, heroCountries[0] ?? 52);
    const smsbowerCountry = asNumber(config.smsbowerCountry, smsbowerCountries[0] ?? 52);
    const heroMaxPrice = asNumber(config.heroSMSMaxPrice, maxOf(heroPriceTiers, 0.05));
    const smsbowerMaxPrice = asNumber(config.smsbowerMaxPrice, maxOf(smsbowerPriceTiers, 0.05));
    const active = smsProvider === "smsbower"
        ? {
            provider: "smsbower",
            providerLabel: "SmsBower",
            apiKeyPresent: Boolean(asString(config.smsbowerApiKey)),
            apiKeyMasked: maskSecret(asString(config.smsbowerApiKey)),
            service: asString(config.smsbowerService, "dr"),
            country: smsbowerCountry,
            countries: smsbowerCountries.length ? smsbowerCountries : [smsbowerCountry],
            maxPrice: smsbowerMaxPrice,
            priceTiers: smsbowerPriceTiers.length ? smsbowerPriceTiers : [smsbowerMaxPrice],
        }
        : {
            provider: "hero-sms",
            providerLabel: "HeroSMS",
            apiKeyPresent: Boolean(asString(config.heroSMSApiKey)),
            apiKeyMasked: maskSecret(asString(config.heroSMSApiKey)),
            service: asString(config.heroSMSService, "dr"),
            country: heroCountry,
            countries: heroCountries.length ? heroCountries : [heroCountry],
            maxPrice: heroMaxPrice,
            priceTiers: heroPriceTiers.length ? heroPriceTiers : [heroMaxPrice],
        };

    return {
        provider: smsProvider,
        active,
        heroSMS: {
            apiKeyPresent: Boolean(asString(config.heroSMSApiKey)),
            apiKeyMasked: maskSecret(asString(config.heroSMSApiKey)),
            baseUrl: asString(config.heroSMSBaseUrl, "https://hero-sms.com/stubs/handler_api.php"),
            service: asString(config.heroSMSService, "dr"),
            country: heroCountry,
            countries: heroCountries.length ? heroCountries : [heroCountry],
            maxPrice: heroMaxPrice,
            priceTiers: heroPriceTiers.length ? heroPriceTiers : [heroMaxPrice],
            pollAttempts: asNumber(config.heroSMSPollAttempts, 10),
            pollIntervalMs: asNumber(config.heroSMSPollIntervalMs, 3000),
        },
        smsbower: {
            apiKeyPresent: Boolean(asString(config.smsbowerApiKey)),
            apiKeyMasked: maskSecret(asString(config.smsbowerApiKey)),
            baseUrl: asString(config.smsbowerBaseUrl, "https://smsbower.online/stubs/handler_api.php"),
            service: asString(config.smsbowerService, "dr"),
            country: smsbowerCountry,
            countries: smsbowerCountries.length ? smsbowerCountries : [smsbowerCountry],
            maxPrice: smsbowerMaxPrice,
            priceTiers: smsbowerPriceTiers.length ? smsbowerPriceTiers : [smsbowerMaxPrice],
            pricePoolIds: Array.isArray(config.smsbowerPricePoolIds) ? config.smsbowerPricePoolIds : [],
            pollAttempts: asNumber(config.smsbowerPollAttempts, 10),
            pollIntervalMs: asNumber(config.smsbowerPollIntervalMs, 3000),
        },
    };
}

function normalizeSmsApiBaseUrl(baseUrl: string, fallback: string): string {
    const normalized = (baseUrl || fallback).trim();
    const url = new URL(normalized);
    if (!url.pathname || url.pathname === "/") {
        url.pathname = "/stubs/handler_api.php";
    } else if (!url.pathname.endsWith("/handler_api.php")) {
        const pathname = url.pathname.replace(/\/+$/, "");
        url.pathname = pathname.endsWith("/stubs")
            ? `${pathname}/handler_api.php`
            : `${pathname}/stubs/handler_api.php`;
    }
    return url.toString();
}

async function fetchSmsApi(
    baseUrl: string,
    apiKey: string,
    action: string,
    query: Record<string, unknown>,
): Promise<unknown> {
    const url = new URL(baseUrl);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(query)) {
        const normalized = String(value ?? "").trim();
        if (normalized) url.searchParams.set(key, normalized);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {Accept: "application/json, text/plain;q=0.9, */*;q=0.8"},
            signal: controller.signal,
        });
        const text = (await response.text()).trim();
        let payload: unknown = text;
        try {
            payload = text ? JSON.parse(text) : "";
        } catch {
            // Some compatible APIs return plain text for errors.
        }
        if (!response.ok) {
            throw new Error(`${action} HTTP ${response.status}: ${String(text).slice(0, 200)}`);
        }
        if (typeof payload === "string" && /^(BAD_|NO_|WRONG_|ERROR_|BANNED|SERVER_ERROR)/i.test(payload)) {
            throw new Error(`${action}: ${payload}`);
        }
        return payload;
    } finally {
        clearTimeout(timeout);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function addPriceItem(items: Map<string, SmsPriceItem>, priceValue: unknown, countValue: unknown, providerId?: unknown): void {
    const price = toFiniteNumber(priceValue);
    if (price == null || price <= 0) return;
    const count = Math.max(0, Math.floor(toFiniteNumber(countValue) ?? 0));
    const key = String(price);
    const existing = items.get(key) ?? {price, count: 0, providerIds: []};
    existing.count += count;
    const provider = String(providerId ?? "").trim();
    if (provider && !existing.providerIds.includes(provider)) existing.providerIds.push(provider);
    items.set(key, existing);
}

function extractSmsPriceItems(payload: unknown, country: number, service: string): SmsPriceItem[] {
    const items = new Map<string, SmsPriceItem>();
    const countryKey = String(country);
    const serviceKey = service.trim();

    const readPriceMap = (value: unknown) => {
        if (!isRecord(value)) return;
        for (const [price, count] of Object.entries(value)) {
            if (isRecord(count) && ("price" in count || "cost" in count)) {
                addPriceItem(items, count.price ?? count.cost, count.count, count.provider_id ?? count.providerId ?? price);
            } else {
                addPriceItem(items, price, count);
            }
        }
    };

    const readServiceNode = (value: unknown) => {
        if (!isRecord(value)) return;
        if ("cost" in value || "price" in value) {
            addPriceItem(items, value.cost ?? value.price, value.count);
            return;
        }
        readPriceMap(value);
    };

    if (isRecord(payload)) {
        const directCountry = payload[countryKey];
        if (isRecord(directCountry) && serviceKey in directCountry) {
            readServiceNode(directCountry[serviceKey]);
        }

        const directService = payload[serviceKey];
        if (isRecord(directService) && countryKey in directService) {
            readServiceNode(directService[countryKey]);
        }

        if (!items.size) {
            for (const [maybeCountry, countryValue] of Object.entries(payload)) {
                if (String(maybeCountry) !== countryKey || !isRecord(countryValue)) continue;
                for (const [maybeService, serviceValue] of Object.entries(countryValue)) {
                    if (String(maybeService) === serviceKey) readServiceNode(serviceValue);
                }
            }
        }
    }

    return Array.from(items.values()).sort((a, b) => a.price - b.price);
}

function extractSmsCountries(payload: unknown): SmsCountryItem[] {
    if (!isRecord(payload)) return [];
    return Object.values(payload)
        .map((value) => {
            if (!isRecord(value)) return null;
            const code = toFiniteNumber(value.id);
            if (code == null) return null;
            return {
                code,
                nameZh: String(value.chn ?? value.zh ?? "").trim(),
                nameEn: String(value.eng ?? value.en ?? "").trim(),
            };
        })
        .filter((item): item is SmsCountryItem => Boolean(item))
        .sort((a, b) => a.code - b.code);
}

async function getSmsCountries(query: URLSearchParams): Promise<Record<string, unknown>> {
    const config = readConfigSync();
    const provider = normalizeEditableSmsProvider(query.get("provider") || config.smsProvider);
    const apiKey = provider === "smsbower" ? asString(config.smsbowerApiKey) : asString(config.heroSMSApiKey);
    if (!apiKey) throw new Error(`${provider === "smsbower" ? "SmsBower" : "HeroSMS"} API Key 未配置`);

    const baseUrl = provider === "smsbower"
        ? normalizeSmsApiBaseUrl(asString(config.smsbowerBaseUrl), "https://smsbower.online/stubs/handler_api.php")
        : normalizeSmsApiBaseUrl(asString(config.heroSMSBaseUrl), "https://hero-sms.com/stubs/handler_api.php");
    const payload = await fetchSmsApi(baseUrl, apiKey, "getCountries", {});
    return {
        provider,
        fetchedAt: nowIso(),
        items: extractSmsCountries(payload),
    };
}

async function getSmsPlatformPrices(query: URLSearchParams): Promise<Record<string, unknown>> {
    const config = readConfigSync();
    const provider = normalizeEditableSmsProvider(query.get("provider") || config.smsProvider);
    const country = Number(query.get("country") || (provider === "smsbower" ? config.smsbowerCountry : config.heroSMSCountry));
    const service = String(query.get("service") || (provider === "smsbower" ? config.smsbowerService : config.heroSMSService) || "dr").trim();
    if (!Number.isFinite(country)) throw new Error("国家代码无效");
    if (!service) throw new Error("服务代码不能为空");

    const apiKey = provider === "smsbower" ? asString(config.smsbowerApiKey) : asString(config.heroSMSApiKey);
    if (!apiKey) throw new Error(`${provider === "smsbower" ? "SmsBower" : "HeroSMS"} API Key 未配置`);

    const baseUrl = provider === "smsbower"
        ? normalizeSmsApiBaseUrl(asString(config.smsbowerBaseUrl), "https://smsbower.online/stubs/handler_api.php")
        : normalizeSmsApiBaseUrl(asString(config.heroSMSBaseUrl), "https://hero-sms.com/stubs/handler_api.php");

    const errors: string[] = [];
    for (const action of ["getPricesV2", "getPricesV3", "getPrices"]) {
        try {
            const payload = await fetchSmsApi(baseUrl, apiKey, action, {country, service});
            const items = extractSmsPriceItems(payload, country, service);
            if (items.length) {
                return {
                    provider,
                    country,
                    service,
                    action,
                    fetchedAt: nowIso(),
                    items,
                };
            }
            errors.push(`${action}: 未返回 ${country}/${service} 的价格`);
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }

    return {
        provider,
        country,
        service,
        fetchedAt: nowIso(),
        items: [],
        error: errors.join(" | "),
    };
}

function createProbeDispatcher(proxyUrl: string): Dispatcher {
    if (!proxyUrl) {
        return new Agent({
            connect: {
                rejectUnauthorized: false,
            },
        });
    }
    const parsed = new URL(proxyUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(`OAuth 网络检测仅支持 http/https 代理: ${parsed.protocol}`);
    }
    return new ProxyAgent({
        uri: proxyUrl,
        requestTls: {
            rejectUnauthorized: false,
        },
    });
}

function buildOpenAiProbeTarget(target: string): string {
    if (target !== "oauth") return "https://auth.openai.com/";
    const state = randomUUID().replace(/-/g, "");
    const challenge = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const url = new URL("https://auth.openai.com/oauth/authorize");
    url.searchParams.set("client_id", DEFAULT_CLIENT_ID);
    url.searchParams.set("code_challenge", challenge.slice(0, 64));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("redirect_uri", DEFAULT_REDIRECT_URI);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid profile email offline_access");
    url.searchParams.set("state", state);
    return url.toString();
}

async function probeOpenAiAuth(query: URLSearchParams): Promise<Record<string, unknown>> {
    const config = readConfigSync();
    const direct = ["1", "true", "yes"].includes(String(query.get("direct") ?? "").trim().toLowerCase());
    const proxyUrl = direct ? "" : String(query.get("proxyUrl") ?? "").trim() || getOaProxyUrl(config);
    const target = buildOpenAiProbeTarget(query.get("target") || "");
    const timeoutMs = query.has("timeoutMs")
        ? safeNumber(query.get("timeoutMs"), 15000, 3000, 60000)
        : 15000;
    const controller = new AbortController();
    const startedAt = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        const response = await fetch(target, {
            method: "GET",
            redirect: query.get("target") === "oauth" ? "follow" : "manual",
            dispatcher: createProbeDispatcher(proxyUrl),
            signal: controller.signal,
            headers: {
                "user-agent": DEFAULT_USER_AGENT,
                "accept-language": "en-US,en;q=0.9",
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        } as RequestInit & {dispatcher: Dispatcher});
        const expectedOAuthRedirect = query.get("target") === "oauth"
            && (response.url.startsWith("https://auth.openai.com/log-in")
                || response.url.startsWith("https://auth.openai.com/sign-in-with-chatgpt/codex/consent")
                || response.url.startsWith(DEFAULT_REDIRECT_URI));
        return {
            ok: response.ok || expectedOAuthRedirect,
            target,
            status: response.status,
            statusText: response.statusText,
            elapsedMs: Date.now() - startedAt,
            proxyUrl: maskUrlSecret(proxyUrl),
            finalUrl: response.url,
            blocked: response.status === 403,
            expected: query.get("target") === "oauth" ? "200/3xx 到 OpenAI 登录页、consent 页或 localhost callback；403 表示当前网络/请求环境被拒绝" : "HTTP 2xx",
        };
    } catch (error) {
        return {
            ok: false,
            target,
            elapsedMs: Date.now() - startedAt,
            proxyUrl: maskUrlSecret(proxyUrl),
            error: describeError(error),
            timeoutMs,
            timedOut,
        };
    } finally {
        clearTimeout(timer);
    }
}

function openAiProbeFailureMessage(probe: Record<string, unknown>): string {
    const proxy = String(probe.proxyUrl || "direct");
    const elapsed = Number(probe.elapsedMs || 0);
    const timedOut = probe.timedOut === true;
    const status = Number(probe.status || 0);
    if (timedOut) {
        return `OA 登录网络检测失败：当前代理连接 auth.openai.com 超时（${elapsed}ms）。代理=${proxy}。请更换能打开 OpenAI OAuth 的代理后再创建任务。`;
    }
    if (status === 403 || probe.blocked === true) {
        return `OA 登录网络检测失败：auth.openai.com 返回 403，当前网络/代理被拒绝。代理=${proxy}。请更换代理后再创建任务。`;
    }
    const detail = String(probe.error || (status ? `HTTP ${status}` : "unknown"));
    return `OA 登录网络检测失败：${detail}。代理=${proxy}。请先通过“测试 OAuth 网络”再创建任务。`;
}

async function assertOaOpenAiReachable(proxyUrl: string): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({
        target: "oauth",
        timeoutMs: "15000",
    });
    if (proxyUrl) {
        query.set("proxyUrl", proxyUrl);
    } else {
        query.set("direct", "1");
    }
    const probe = await probeOpenAiAuth(query);
    if (probe.ok !== true) {
        const error = new Error(openAiProbeFailureMessage(probe)) as Error & {probe?: Record<string, unknown>};
        error.probe = probe;
        throw error;
    }
    return probe;
}

function createSmsCancelProvider(provider: EditableSmsProvider): SmsProvider | null {
    const config = readConfigSync();
    if (provider === "smsbower") {
        const apiKey = asString(config.smsbowerApiKey);
        if (!apiKey) return null;
        return createSmsBowerProvider({
            apiKey,
            baseUrl: asString(config.smsbowerBaseUrl, "https://smsbower.online/stubs/handler_api.php"),
        });
    }

    const apiKey = asString(config.heroSMSApiKey);
    if (!apiKey) return null;
    return createHeroSmsProvider({
        apiKey,
        baseUrl: asString(config.heroSMSBaseUrl),
    });
}

function isRetryableSmsCancelError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /EARLY_CANCEL_DENIED|NO_ACTIVATION|STATUS_WAIT_CODE|STATUS_WAIT_RETRY|SERVER_ERROR|timeout|ETIMEDOUT|ECONNRESET/i.test(message);
}

async function cancelSmsActivationForTask(task: RuntimeRegisterTask): Promise<void> {
    if (task.kind !== "register") return;
    const activationId = task.phoneActivationId?.trim();
    if (!activationId) {
        appendTaskLog(task, "system", "sms cancel skipped: no activationId captured yet");
        return;
    }
    if (task.smsCanceledAt) {
        appendTaskLog(task, "system", `sms cancel skipped: already canceled at ${task.smsCanceledAt}`);
        return;
    }
    if (smsCancelInFlight.has(task.id)) return;
    smsCancelInFlight.add(task.id);
    task.smsCancelRequestedAt = task.smsCancelRequestedAt ?? nowIso();
    saveRegisterTasksLater();

    try {
        const providerName = normalizeTaskSmsProvider(task.phoneProvider);
        const provider = createSmsCancelProvider(providerName);
        if (!provider) {
            throw new Error(`SMS provider ${providerName} apiKey not configured`);
        }
        const attempts = 8;
        const retryDelayMs = 30000;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                appendTaskLog(task, "system", `sms cancel attempt ${attempt}/${attempts}: provider=${providerName} activationId=${activationId}`);
                const result = await provider.cancelActivation(activationId);
                task.smsCanceledAt = nowIso();
                task.smsCancelResult = String(result);
                task.smsCancelError = undefined;
                appendTaskLog(task, "system", `sms cancel success: ${result}`);
                saveRegisterTasksLater();
                return;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                task.smsCancelError = message;
                appendTaskLog(task, "system", `sms cancel failed: ${message}`);
                saveRegisterTasksLater();
                if (attempt >= attempts || !isRetryableSmsCancelError(error)) {
                    throw error;
                }
                await delay(retryDelayMs);
            }
        }
    } finally {
        smsCancelInFlight.delete(task.id);
    }
}

function getConfigSummary(): Record<string, unknown> {
    const ppxy = getPpxyConfig();
    const config = readConfigSync();
    const sms = getSmsConfigView(config);
    const sub2apiUrl = asString(config.sub2apiUrl);
    const sub2apiEmail = asString(config.sub2apiEmail);
    const sub2apiPassword = asString(config.sub2apiPassword);
    const sub2apiGroupNames = Array.isArray(config.sub2apiGroupNames)
        ? config.sub2apiGroupNames.map((item) => String(item).trim()).filter(Boolean)
        : [];
    return {
        register: {
            provider: asString(config.provider),
            defaultPassword: asString(config.defaultPassword) ? "configured" : "missing",
            defaultProxyUrl: maskUrlSecret(asString(config.defaultProxyUrl)),
            oaProxyUrl: maskUrlSecret(getOaProxyUrl(config)),
            sms,
            cliproxyApiAutoUploadAuth: Boolean(config.cliproxyApiAutoUploadAuth),
            cliproxyApiBaseUrl: asString(config.cliproxyApiBaseUrl),
            cliproxyApiManagementKey: asString(config.cliproxyApiManagementKey) ? maskSecret(asString(config.cliproxyApiManagementKey)) : "",
        },
        ppxy: {
            baseUrl: ppxy.baseUrl,
            apiKeyPresent: Boolean(ppxy.apiKey),
            apiKeyMasked: maskSecret(ppxy.apiKey),
            proxyJp: maskUrlSecret(ppxy.proxyJp),
            tokenFile: ppxy.tokenFile,
        },
        sub2api: {
            url: sub2apiUrl,
            email: sub2apiEmail,
            passwordPresent: Boolean(sub2apiPassword),
            passwordMasked: sub2apiPassword ? maskSecret(sub2apiPassword) : "",
            groupName: asString(config.sub2apiGroupName, "codex"),
            groupNames: sub2apiGroupNames,
            proxyName: asString(config.sub2apiProxyName),
            accountPriority: asNumber(config.sub2apiAccountPriority, 1),
            concurrency: asNumber(config.sub2apiConcurrency, 10),
        },
        mailApi: {
            baseUrl: getMailApiBaseUrl(),
        },
        runtime: {
            host: process.env.HOST || "127.0.0.1",
            port: process.env.PORT || "auto",
            sentinelBrowserProxy: maskUrlSecret(process.env.SENTINEL_BROWSER_PROXY || ""),
            sentinelBrowserPath: process.env.SENTINEL_BROWSER_PATH || "",
        },
    };
}

function getRegisterPasswordView(): Record<string, unknown> {
    const password = asString(readConfigSync().defaultPassword);
    return {
        configured: Boolean(password),
        password,
    };
}

async function updateRegisterPassword(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const password = String(body.password ?? body.defaultPassword ?? "");
    if (!password.trim()) throw new Error("默认密码不能为空");
    if (password.length < 8) throw new Error("默认密码至少 8 位");
    const config = await readConfigForWrite();
    config.defaultPassword = password;
    await writeJsonFile(configFile, config);
    return getRegisterPasswordView();
}

async function updateSmsConfig(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const provider = normalizeEditableSmsProvider(body.provider ?? body.smsProvider);
    const service = String(body.service ?? "").trim() || "dr";
    const apiKey = String(body.apiKey ?? "").trim();
    const baseUrl = String(body.baseUrl ?? "").trim();
    const countries = parseNumberList(body.countries, "国家", {integer: true});
    const priceTiers = parseNumberList(body.priceTiers, "价格区间", {positive: true}).sort((a, b) => a - b);
    if (!countries.length) throw new Error("至少填写一个国家代码");
    if (!priceTiers.length) throw new Error("至少填写一个价格");

    const config = await readConfigForWrite();
    config.smsProvider = provider;
    if (provider === "smsbower") {
        if (apiKey) config.smsbowerApiKey = apiKey;
        if (baseUrl) config.smsbowerBaseUrl = normalizeSmsApiBaseUrl(baseUrl, "https://smsbower.online/stubs/handler_api.php");
        config.smsbowerService = service;
        config.smsbowerCountry = countries[0];
        config.smsbowerCountries = countries;
        config.smsbowerMaxPriceTiers = priceTiers;
        config.smsbowerMaxPrice = maxOf(priceTiers, asNumber(config.smsbowerMaxPrice, priceTiers[0]));
    } else {
        if (apiKey) config.heroSMSApiKey = apiKey;
        if (baseUrl) config.heroSMSBaseUrl = normalizeSmsApiBaseUrl(baseUrl, "https://hero-sms.com/stubs/handler_api.php");
        config.heroSMSService = service;
        config.heroSMSCountry = countries[0];
        config.heroSMSCountries = countries;
        config.heroSMSPriceTiers = priceTiers;
        config.heroSMSMaxPrice = maxOf(priceTiers, asNumber(config.heroSMSMaxPrice, priceTiers[0]));
    }

    await writeJsonFile(configFile, config);
    return getConfigSummary();
}

async function updateSub2ApiConfig(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const config = await readConfigForWrite();
    const url = String(body.url ?? body.sub2apiUrl ?? "").trim();
    const email = String(body.email ?? body.sub2apiEmail ?? "").trim();
    const password = String(body.password ?? body.sub2apiPassword ?? "");
    const groupNames = parseStringList(body.groupNames ?? body.sub2apiGroupNames ?? body.groupName ?? body.sub2apiGroupName);
    const proxyName = String(body.proxyName ?? body.sub2apiProxyName ?? "").trim();
    const priority = safeNumber(body.accountPriority ?? body.sub2apiAccountPriority, asNumber(config.sub2apiAccountPriority, 1), 1, 1000000);
    const concurrency = safeNumber(body.concurrency ?? body.sub2apiConcurrency, asNumber(config.sub2apiConcurrency, 10), 1, 1000000);

    if (!url) throw new Error("SUB2API 地址不能为空");
    if (!email) throw new Error("SUB2API 账号不能为空");
    if (!password && !asString(config.sub2apiPassword)) throw new Error("SUB2API 密码不能为空");
    if (!groupNames.length) throw new Error("SUB2API 导入分组不能为空");

    config.sub2apiUrl = url;
    config.sub2apiEmail = email;
    if (password) config.sub2apiPassword = password;
    config.sub2apiGroupName = groupNames[0];
    config.sub2apiGroupNames = groupNames.length > 1 ? groupNames : [];
    config.sub2apiProxyName = proxyName;
    config.sub2apiAccountPriority = priority;
    config.sub2apiConcurrency = concurrency;

    await writeJsonFile(configFile, config);
    return getConfigSummary();
}

async function updateMailApiConfig(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const config = await readConfigForWrite();
    config.mailApiBaseUrl = validateMailApiBaseUrl(String(body.baseUrl ?? body.mailApiBaseUrl ?? ""));
    await writeJsonFile(configFile, config);
    return getConfigSummary();
}

async function updateOaProxyConfig(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const config = await readConfigForWrite();
    const raw = String(body.proxyUrl ?? body.defaultProxyUrl ?? body.oaProxyUrl ?? "").trim();
    if (raw && raw.toLowerCase() !== "direct") {
        new URL(raw);
    }
    config.defaultProxyUrl = raw.toLowerCase() === "direct" ? "" : raw;
    await writeJsonFile(configFile, config);
    return getConfigSummary();
}

function getTsxCli(): string {
    return path.join(appDir, "node_modules", "tsx", "dist", "cli.mjs");
}

function taskLogPath(taskId: string): string {
    return path.join(logDir, `${taskId}.log`);
}

function appendTaskLog(task: RuntimeRegisterTask, stream: "stdout" | "stderr" | "system", text: string): void {
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (const line of normalized.split("\n")) {
        if (!line) continue;
        const item = `[${new Date().toLocaleString()}] [${stream}] ${line}`;
        task.logs.push(item);
        if (task.logs.length > 500) task.logs.splice(0, task.logs.length - 500);
        parseTaskOutputLine(task, line);
        void appendFile(taskLogPath(task.id), `${item}\n`, "utf8").catch(() => undefined);
    }
    task.updatedAt = nowIso();
}

function extractOutputPathFromLine(line: string): string {
    const winMatch = line.match(/([A-Za-z]:[\\/].*)$/);
    if (winMatch) return winMatch[1].trim();
    const unixMatch = line.match(/\s((?:\/[^/\s]+)+)\s*$/);
    return unixMatch ? unixMatch[1].trim() : "";
}

function parseSmsCost(value: string): number | undefined {
    const normalized = value.trim();
    if (!normalized || normalized === "?") return undefined;
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    const cost = Number(match[0]);
    return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

function parseTaskOutputLine(task: RuntimeRegisterTask, line: string, options: {allowFinish?: boolean} = {}): void {
    const allowFinish = options.allowFinish ?? true;
    const phoneSignupFinalError = line.match(/\[(?:phone-signup|codex-cpa)\]\s+final-error:\s+(.+)$/);
    if (phoneSignupFinalError) {
        task.error = phoneSignupFinalError[1].trim();
    }
    const authFailure = line.match(/\[❌️授权失败\]\s+(?:Error:\s*)?(.+)$/);
    if (authFailure && !task.error) {
        task.error = authFailure[1].trim();
    }
    const blackPhoneMatch = line.match(/\[(?:phone-signup|codex-cpa)\]\s+black phone=(\+\d+)\s+reason=([^\s;]+).*?\bcancel=([^;\s]+)/);
    if (blackPhoneMatch) {
        task.phone = blackPhoneMatch[1];
        task.error = `号码 ${blackPhoneMatch[1]} 已被 OpenAI 判定 ${blackPhoneMatch[2]}，已执行取消/退回(${blackPhoneMatch[3]})并换号`;
        updateTaskTitle(task);
    }
    const tokenMatch = line.match(/\[access_token\]\s+(.+)$/);
    if (tokenMatch) {
        const token = tokenMatch[1].trim();
        if (token) {
            task.accessTokenHash = tokenHash(token);
            task.accessTokenPreview = tokenPreview(token);
        }
    }
    if (line.includes("[gp_token_out]")) {
        const outputPath = extractOutputPathFromLine(line);
        if (outputPath) task.tokenOut = path.resolve(outputPath);
    }
    if (line.includes("[pool_phones]")) {
        const outputPath = extractOutputPathFromLine(line);
        if (outputPath) task.successTextFile = path.resolve(outputPath);
        if (allowFinish) finishTaskFromSuccessfulOutput(task, "pool_phones");
    }
    const costMatch = line.match(/(?:^|\s)cost=([^\s,;]+)/i) ?? line.match(/(?:价格|成本)[:=：]\s*([0-9.]+)/);
    if (costMatch) {
        const cost = parseSmsCost(costMatch[1]);
        if (cost !== undefined) {
            task.smsCost = cost;
            task.smsCostCurrency = "USD";
        }
    }
    const phoneMatch = line.match(/\[phone\]\s+(\+\d+)/);
    if (phoneMatch) {
        task.phone = phoneMatch[1];
        updateTaskTitle(task);
    }

    const gotPhoneMatch = line.match(/(?:取到号码|取到|phone=)(\+\d+)/);
    if (gotPhoneMatch) {
        task.phone = gotPhoneMatch[1];
        updateTaskTitle(task);
    }

    if (line.toLowerCase().includes("[smsbower]")) {
        task.phoneProvider = "smsbower";
    }
    if (line.toLowerCase().includes("[hero") || line.toLowerCase().includes("hero-sms")) {
        task.phoneProvider = "herosms";
    }
    const bindEmailMatch = line.match(/\[bind_email\]\s+(.+)$/);
    if (bindEmailMatch) {
        task.bindEmail = bindEmailMatch[1].trim();
        updateTaskTitle(task);
    }
    const sub2apiAccountMatch = line.match(/\[sub2api_account\]\s+(.+)$/);
    if (sub2apiAccountMatch) {
        task.sub2apiAccount = sub2apiAccountMatch[1].trim();
        if (allowFinish) finishTaskFromSuccessfulOutput(task, "sub2api_account");
    }
    const sub2apiCreatedMatch = line.match(/SUB2API 已创建账号:\s+(.+)$/);
    if (sub2apiCreatedMatch) {
        task.sub2apiAccount = sub2apiCreatedMatch[1].trim();
    }
    const oaBindMatch = line.match(/\[oa-sub2api\]\s+bind_email=(.+)$/);
    if (oaBindMatch) {
        task.bindEmail = oaBindMatch[1].trim();
        updateTaskTitle(task);
    }
    const oaMailboxMatch = line.match(/\[oa-sub2api\]\s+mailbox_url=(.+)$/);
    if (oaMailboxMatch) {
        task.mailboxUrl = oaMailboxMatch[1].trim();
    }

    const activationMatch = line.match(/activationId=([A-Za-z0-9_-]+)/i);
    if (activationMatch) {
        task.phoneActivationId = activationMatch[1];
        task.phoneActivationAt = task.phoneActivationAt ?? nowIso();
        updateTaskTitle(task);
    }

    const smsBowerSuccess = line.match(/\[smsbower\].*phone=(\+\d+)/i);
    if (smsBowerSuccess) {
        task.phoneProvider = "smsbower";
        task.phone = smsBowerSuccess[1];
        updateTaskTitle(task);
    }
}

function updateTaskTitle(task: RuntimeRegisterTask): void {
    if (task.kind === "oa-sub2api") {
        const phone = task.phone || "phone";
        const email = task.bindEmail || "email";
        task.title = `OA ${phone} -> ${email}`;
        return;
    }
    if (!task.phone) return;
    const provider = task.phoneProvider || "phone";
    const id = task.phoneActivationId || task.id.slice(-8);
    task.title = `${task.phone}_${provider}_${id}`;
}

function taskHasSuccessOutput(task: RuntimeRegisterTask): boolean {
    if (task.kind === "oa-sub2api") {
        return Boolean(task.sub2apiAccount);
    }
    return Boolean(task.accessTokenHash);
}

function finishTaskFromSuccessfulOutput(task: RuntimeRegisterTask, reason: string): void {
    if (task.status !== "running") return;
    if (!taskHasSuccessOutput(task)) return;
    finishRegisterTask(task, "success", {
        code: 0,
        signal: null,
        reason: `success output captured: ${reason}`,
        terminateChild: true,
    });
}

function normalizeLoadedTask(task: RegisterTask): RuntimeRegisterTask {
    const runtime: RuntimeRegisterTask = {...task, logs: task.logs ?? []};
    for (const log of runtime.logs) {
        const line = log.replace(/^\[[^\]]+\]\s+\[[^\]]+\]\s+/, "");
        parseTaskOutputLine(runtime, line, {allowFinish: false});
    }
    updateTaskTitle(runtime);
    return runtime;
}

function finishRegisterTask(
    task: RuntimeRegisterTask,
    status: TaskStatus,
    options: {code?: number | null; signal?: string | null; reason: string; terminateChild?: boolean},
): boolean {
    if (task.finishedAt) {
        task.exitCode = task.exitCode ?? options.code;
        task.signal = task.signal ?? options.signal;
        saveRegisterTasksLater();
        return false;
    }

    if (task.startedAt) {
        registerRunning = Math.max(0, registerRunning - 1);
    }

    task.status = status;
    task.exitCode = options.code;
    task.signal = options.signal ?? null;
    task.finishedAt = nowIso();
    task.updatedAt = task.finishedAt;
    if (status === "failed" && !task.error) {
        task.error = `exit code ${options.code}`;
    }
    if (status === "success") {
        task.error = undefined;
    }

    const removeTokenHash = task.kind === "oa-sub2api"
        ? task.sourceAccessTokenHash || task.accessTokenHash
        : task.accessTokenHash;
    if (task.kind === "oa-sub2api" && task.status === "success" && removeTokenHash && task.args.includes("--remove-token-on-success")) {
        void removeTokenByHash(removeTokenHash).catch((error) => {
            appendTaskLog(task, "system", `remove token failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    if (task.kind === "oa-sub2api" && task.bindEmail) {
        const emailStatus: OaEmailBindStatus = task.status === "success"
            ? "bound"
            : task.status === "canceled"
                ? "canceled"
                : "failed";
        recordOaTaskEmailStatus(task, emailStatus);
        appendTaskLog(task, "system", `email status recorded: ${task.bindEmail} -> ${emailStatus}`);
    }

    appendTaskLog(task, "system", `finished: status=${task.status} code=${options.code ?? ""} signal=${options.signal ?? ""} (${options.reason})`);
    if (options.terminateChild && task.child && task.child.exitCode === null) {
        appendTaskLog(task, "system", "success captured; terminating lingering child process");
        killProcessTree(task.child);
    }
    saveRegisterTasksLater();
    scheduleRegisterTasks();
    return true;
}

function scheduleRegisterTasks(): void {
    while (registerRunning < registerMaxConcurrency && registerQueue.length > 0) {
        const task = registerQueue.shift();
        if (!task || task.status !== "queued") continue;
        startRegisterTask(task);
    }
}

function startRegisterTask(task: RuntimeRegisterTask): void {
    registerRunning += 1;
    task.status = "running";
    task.startedAt = nowIso();
    task.updatedAt = task.startedAt;
    const command = process.execPath;
    const args = [getTsxCli(), ...task.args];
    appendTaskLog(task, "system", `starting: ${command} ${redactCliArgs(args).join(" ")}`);

    const child = spawn(command, args, {
        cwd: appDir,
        env: task.env,
        shell: false,
        windowsHide: true,
    });
    task.child = child;

    child.stdout.on("data", (chunk: Buffer) => appendTaskLog(task, "stdout", chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => appendTaskLog(task, "stderr", chunk.toString("utf8")));
    child.on("error", (error) => {
        task.error = error.message;
        appendTaskLog(task, "system", `spawn error: ${error.message}`);
    });
    child.on("close", (code, signal) => {
        const finalStatus = task.status === "canceled"
            ? "canceled"
            : code === 0 || taskHasSuccessOutput(task)
                ? "success"
                : "failed";
        finishRegisterTask(task, finalStatus, {
            code,
            signal,
            reason: "child process closed",
        });
    });

    saveRegisterTasksLater();
}

function createRegisterTasks(body: Record<string, unknown>): RegisterTask[] {
    const count = safeNumber(body.count, 10, 1, 100);
    const concurrency = safeNumber(body.concurrency, 10, 1, 10);
    registerMaxConcurrency = concurrency;

    const ppxy = getPpxyConfig();
    const tokenOut = path.resolve(String(body.tokenOut || ppxy.tokenFile));
    const env: NodeJS.ProcessEnv = {...process.env};
    if (typeof body.sentinelBrowserProxy === "string" && body.sentinelBrowserProxy.trim()) {
        env.SENTINEL_BROWSER_PROXY = body.sentinelBrowserProxy.trim();
    }
    if (typeof body.sentinelBrowserPath === "string" && body.sentinelBrowserPath.trim()) {
        env.SENTINEL_BROWSER_PATH = body.sentinelBrowserPath.trim();
    }

    const created: RegisterTask[] = [];
    for (let i = 0; i < count; i += 1) {
        const id = `reg_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const task: RuntimeRegisterTask = {
            id,
            kind: "register",
            status: "queued",
            title: `phone register #${i + 1}`,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            args: ["src/index.ts", "--phone", "--at", "--st", "--gp-token-out", tokenOut],
            tokenOut,
            logs: [],
            env,
        };
        registerTasks.set(id, task);
        registerQueue.push(task);
        created.push(task);
        appendTaskLog(task, "system", `queued tokenOut=${tokenOut}`);
    }
    saveRegisterTasksLater();
    scheduleRegisterTasks();
    return created;
}

function parseEmailPoolEntry(line: string, mailApiBaseUrl = ""): {email: string; mailboxUrl: string; raw: string; kind: "url" | "hotmail"} | null {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) return null;
    const parts = raw.split(/\s*-{4,}\s*|\t|,/).map((item) => item.trim()).filter(Boolean);
    const email = parts.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) ?? "";
    const directMailboxUrl = parts.find((item) => /^https?:\/\//i.test(item)) ?? "";
    let mailboxUrl = directMailboxUrl;
    if (!mailboxUrl && email && parts.length >= 4 && mailApiBaseUrl.trim()) {
        const emailIndex = parts.findIndex((item) => item.toLowerCase() === email.toLowerCase());
        const tail = parts.slice(emailIndex + 1);
        const clientId = tail.length >= 3 ? tail[1] : parts[2] ?? "";
        const refreshToken = tail.length >= 3 ? tail.slice(2).join("----") : parts.slice(3).join("----");
        if (clientId && refreshToken) {
            mailboxUrl = buildMicrosoftMailboxUrl(mailApiBaseUrl, email, clientId, refreshToken);
        }
    }
    if (email && mailboxUrl) return {email, mailboxUrl, raw, kind: directMailboxUrl ? "url" : "hotmail"};
    if (email && parts.length >= 4) return {email, mailboxUrl: "", raw, kind: "hotmail"};
    return null;
}

function buildMicrosoftMailboxUrl(baseUrl: string, email: string, clientId: string, refreshToken: string): string {
    const withProtocol = /^https?:\/\//i.test(baseUrl.trim())
        ? baseUrl.trim()
        : `http://${baseUrl.trim()}`;
    const url = new URL(withProtocol);
    if (!url.pathname || url.pathname === "/") {
        url.pathname = "/api/GetLastEmails";
    } else if (!url.pathname.endsWith("/api/GetLastEmails")) {
        url.pathname = `${url.pathname.replace(/\/+$/g, "")}/api/GetLastEmails`;
    }
    url.searchParams.set("email", email);
    url.searchParams.set("clientId", clientId);
    url.searchParams.set("refreshToken", refreshToken);
    url.searchParams.set("num", "2");
    url.searchParams.set("boxType", "1");
    return url.toString();
}

function isPlaceholderMailboxUrl(value: string): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return host === "mail-api.example" || host.endsWith(".example") || host === "example.com" || host.endsWith(".example.com");
    } catch {
        return false;
    }
}

function emailStatusKey(email: string): string {
    return email.trim().toLowerCase();
}

function getOaEmailStatus(email: string): OaEmailStatusRecord | undefined {
    return oaEmailStatus.emails[emailStatusKey(email)];
}

function setOaEmailStatus(email: string, patch: Partial<OaEmailStatusRecord> & {status?: OaEmailBindStatus}): OaEmailStatusRecord {
    const key = emailStatusKey(email);
    const current = oaEmailStatus.emails[key];
    const status = patch.status ?? current?.status ?? "free";
    const next: OaEmailStatusRecord = {
        email: email.trim(),
        status,
        phone: patch.phone ?? current?.phone,
        taskId: patch.taskId ?? current?.taskId,
        sub2apiAccount: patch.sub2apiAccount ?? current?.sub2apiAccount,
        accessTokenHash: patch.accessTokenHash ?? current?.accessTokenHash,
        error: patch.error ?? current?.error,
        note: patch.note ?? current?.note,
        updatedAt: nowIso(),
    };
    if (status === "free") {
        delete next.phone;
        delete next.taskId;
        delete next.sub2apiAccount;
        delete next.accessTokenHash;
        delete next.error;
    }
    oaEmailStatus.emails[key] = next;
    return next;
}

async function updateOaEmailStatus(email: string, patch: Partial<OaEmailStatusRecord> & {status?: OaEmailBindStatus}): Promise<OaEmailStatusRecord> {
    const next = setOaEmailStatus(email, patch);
    await saveOaEmailStatus();
    return next;
}

function recordOaTaskEmailStatus(task: RuntimeRegisterTask, status: OaEmailBindStatus, error = ""): void {
    if (task.kind !== "oa-sub2api" || !task.bindEmail) return;
    setOaEmailStatus(task.bindEmail, {
        status,
        phone: task.phone,
        taskId: task.id,
        sub2apiAccount: task.sub2apiAccount,
        accessTokenHash: task.accessTokenHash,
        error: error || task.error,
        note: `oauth ${status}`,
    });
    saveOaEmailStatusLater();
}

function getOaEmailAssignments(): Map<string, RuntimeRegisterTask> {
    const assigned = new Map<string, RuntimeRegisterTask>();
    for (const task of registerTasks.values()) {
        if (task.kind !== "oa-sub2api") continue;
        if (!["queued", "running"].includes(task.status)) continue;
        if (!task.bindEmail) continue;
        const key = task.bindEmail.toLowerCase();
        if (!assigned.has(key)) assigned.set(key, task);
    }
    return assigned;
}

function resolveOaSavedBindStatus(itemEmail: string, savedStatus?: OaEmailStatusRecord): OaEmailBindStatus {
    if (!savedStatus) return "free";
    if (savedStatus.status !== "reserved") return savedStatus.status;
    const taskId = savedStatus.taskId?.trim();
    if (!taskId) return "free";
    const task = registerTasks.get(taskId);
    if (!task || task.kind !== "oa-sub2api" || task.bindEmail?.toLowerCase() !== itemEmail.toLowerCase()) {
        return "free";
    }
    if (task.status === "queued" || task.status === "running") return "reserved";
    if (task.status === "success") return "bound";
    if (task.status === "canceled") return "canceled";
    return "failed";
}

async function readOaEmailPool(): Promise<OaEmailPoolItem[]> {
    const raw = await readFile(oaEmailPoolFile, "utf8").catch(() => "");
    const mailApiBaseUrl = getMailApiBaseUrl();
    const assigned = getOaEmailAssignments();
    return raw
        .split(/\r?\n/)
        .map((line) => parseEmailPoolEntry(line, mailApiBaseUrl))
        .filter((item): item is {email: string; mailboxUrl: string; raw: string; kind: "url" | "hotmail"} => Boolean(item))
        .map((item, index) => {
            const assignedTask = assigned.get(item.email.toLowerCase());
            const savedStatus = getOaEmailStatus(item.email);
            const usableMailbox = item.kind === "hotmail" || (Boolean(item.mailboxUrl) && !isPlaceholderMailboxUrl(item.mailboxUrl));
            const bindStatus = assignedTask
                ? "reserved"
                : resolveOaSavedBindStatus(item.email, savedStatus);
            const reusableStatus = bindStatus === "free" || bindStatus === "failed" || bindStatus === "canceled";
            return {
                index,
                email: item.email,
                mailboxUrl: item.mailboxUrl,
                raw: item.raw,
                kind: item.kind,
                preview: item.raw.length <= 120 ? item.raw : `${item.raw.slice(0, 80)}...${item.raw.slice(-24)}`,
                available: !assignedTask && usableMailbox && reusableStatus,
                assignedTaskId: assignedTask?.id,
                assignedTaskStatus: assignedTask?.status,
                assignedPhone: assignedTask?.phone,
                bindStatus,
                bindPhone: assignedTask?.phone ?? savedStatus?.phone,
                bindTaskId: assignedTask?.id ?? savedStatus?.taskId,
                bindSub2ApiAccount: savedStatus?.sub2apiAccount,
                bindAccessTokenHash: savedStatus?.accessTokenHash,
                bindError: savedStatus?.error,
                bindUpdatedAt: savedStatus?.updatedAt,
                bindNote: savedStatus?.note,
            };
        });
}

async function importOaEmails(raw: string, mailApiBaseUrl = ""): Promise<{added: number; updated: number; skipped: number; total: number; invalid: number; invalidSamples: string[]; needsMailApiBaseUrl: boolean}> {
    const providedMailApiBaseUrl = validateMailApiBaseUrl(mailApiBaseUrl);
    const effectiveMailApiBaseUrl = providedMailApiBaseUrl || getMailApiBaseUrl();
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    const incoming: Array<{email: string; mailboxUrl: string; raw: string; kind: "url" | "hotmail"}> = [];
    const invalidSamples: string[] = [];
    for (const line of lines) {
        const item = parseEmailPoolEntry(line, effectiveMailApiBaseUrl);
        if (item) {
            incoming.push(item);
        } else if (invalidSamples.length < 3) {
            invalidSamples.push(line.slice(0, 160));
        }
    }
    const existingRaw = await readFile(oaEmailPoolFile, "utf8").catch(() => "");
    const existingLines = existingRaw.split(/\r?\n/);
    const existing = new Map<string, {index: number; item: {email: string; mailboxUrl: string; raw: string; kind: "url" | "hotmail"}}>();
    for (const [index, line] of existingLines.entries()) {
        const item = parseEmailPoolEntry(line);
        if (!item) continue;
        const key = item.email.toLowerCase();
        if (!existing.has(key)) existing.set(key, {index, item});
    }
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const nextLines = existingLines.slice();
    for (const item of incoming) {
        const key = item.email.toLowerCase();
        const nextLine = item.mailboxUrl ? `${item.email}-----${item.mailboxUrl}` : item.raw;
        const current = existing.get(key);
        if (!current) {
            nextLines.push(nextLine);
            existing.set(key, {index: nextLines.length - 1, item});
            added += 1;
            continue;
        }
        if (current.item.mailboxUrl !== item.mailboxUrl || nextLines[current.index].trim() !== nextLine) {
            nextLines[current.index] = nextLine;
            current.item = item;
            updated += 1;
            continue;
        }
        skipped += 1;
    }
    if (added > 0 || updated > 0) {
        await mkdir(path.dirname(oaEmailPoolFile), {recursive: true});
        await writeFile(oaEmailPoolFile, `${nextLines.map((line) => line.trim()).filter(Boolean).join("\n")}\n`, "utf8");
    }
    if (providedMailApiBaseUrl) {
        const config = await readConfigForWrite();
        if (asString(config.mailApiBaseUrl) !== providedMailApiBaseUrl) {
            config.mailApiBaseUrl = providedMailApiBaseUrl;
            await writeJsonFile(configFile, config);
        }
    }
    return {
        added,
        updated,
        skipped,
        total: existing.size,
        invalid: lines.length - incoming.length,
        invalidSamples,
        needsMailApiBaseUrl: incoming.some((item) => !item.mailboxUrl),
    };
}

async function rebaseOaEmailMailboxUrls(mailApiBaseUrl: string): Promise<{updated: number; skipped: number; invalid: number; total: number}> {
    const baseUrl = validateMailApiBaseUrl(mailApiBaseUrl);
    if (!baseUrl) throw new Error("接码 API 域名不能为空");

    const raw = await readFile(oaEmailPoolFile, "utf8").catch(() => "");
    const lines = raw.split(/\r?\n/);
    const nextLines = lines.slice();
    let updated = 0;
    let skipped = 0;
    let invalid = 0;

    for (const [index, line] of lines.entries()) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const item = parseEmailPoolEntry(trimmed);
        if (!item) {
            invalid += 1;
            continue;
        }

        let nextMailboxUrl = "";
        if (item.mailboxUrl) {
            try {
                const current = new URL(item.mailboxUrl);
                const clientId = current.searchParams.get("clientId") ?? "";
                const refreshToken = current.searchParams.get("refreshToken") ?? "";
                if (clientId && refreshToken) {
                    nextMailboxUrl = buildMicrosoftMailboxUrl(baseUrl, item.email, clientId, refreshToken);
                }
            } catch {
                invalid += 1;
                continue;
            }
        } else {
            const parts = trimmed.split(/\s*-{4,}\s*|\t|,/).map((part) => part.trim()).filter(Boolean);
            const emailIndex = parts.findIndex((part) => part.toLowerCase() === item.email.toLowerCase());
            const tail = emailIndex >= 0 ? parts.slice(emailIndex + 1) : parts.slice(1);
            const clientId = tail.length >= 3 ? tail[1] : parts[2] ?? "";
            const refreshToken = tail.length >= 3 ? tail.slice(2).join("----") : parts.slice(3).join("----");
            if (clientId && refreshToken) {
                nextMailboxUrl = buildMicrosoftMailboxUrl(baseUrl, item.email, clientId, refreshToken);
            }
        }

        if (!nextMailboxUrl) {
            skipped += 1;
            continue;
        }

        const nextLine = `${item.email}-----${nextMailboxUrl}`;
        if (trimmed === nextLine) {
            skipped += 1;
            continue;
        }
        nextLines[index] = nextLine;
        updated += 1;
    }

    if (updated > 0) {
        await mkdir(path.dirname(oaEmailPoolFile), {recursive: true});
        await writeFile(oaEmailPoolFile, `${nextLines.map((line) => line.trim()).filter(Boolean).join("\n")}\n`, "utf8");
    }

    const config = await readConfigForWrite();
    if (asString(config.mailApiBaseUrl) !== baseUrl) {
        config.mailApiBaseUrl = baseUrl;
        await writeJsonFile(configFile, config);
    }

    return {updated, skipped, invalid, total: updated + skipped + invalid};
}

async function removeOaEmail(email: string): Promise<boolean> {
    const target = email.trim().toLowerCase();
    if (!target) return false;
    const raw = await readFile(oaEmailPoolFile, "utf8").catch(() => "");
    const lines = raw.split(/\r?\n/);
    const next = lines.filter((line) => {
        const item = parseEmailPoolEntry(line);
        return !item || item.email.toLowerCase() !== target;
    });
    if (next.length === lines.length) return false;
    await writeFile(oaEmailPoolFile, `${next.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
    delete oaEmailStatus.emails[emailStatusKey(target)];
    saveOaEmailStatusLater();
    return true;
}

function normalizeOaEmailBindStatus(value: unknown): OaEmailBindStatus {
    const text = String(value ?? "").trim().toLowerCase();
    if (["free", "reserved", "bound", "failed", "canceled", "disabled"].includes(text)) {
        return text as OaEmailBindStatus;
    }
    throw new Error("邮箱状态只能是 free/reserved/bound/failed/canceled/disabled");
}

function normalizeOaBindPhone(value: string): string {
    const compact = value.trim().replace(/[\s()-]/g, "");
    if (!compact) return "";
    if (compact.startsWith("+")) {
        const digits = compact.slice(1).replace(/[^\d]/g, "");
        return digits ? `+${digits}` : "";
    }
    const digits = compact.replace(/[^\d]/g, "");
    return digits ? `+${digits}` : "";
}

async function patchOaEmailStatus(email: string, body: Record<string, unknown>): Promise<OaEmailStatusRecord> {
    const target = email.trim();
    if (!target) throw new Error("邮箱不能为空");
    const status = normalizeOaEmailBindStatus(body.status ?? body.bindStatus);
    const rawPhone = body.phone ?? body.bindPhone;
    const phoneProvided = rawPhone !== undefined;
    const currentPhone = getOaEmailStatus(target)?.phone ?? "";
    const phone = phoneProvided ? normalizeOaBindPhone(asString(rawPhone)) : currentPhone.trim();
    if (status === "bound" && !phone) {
        throw new Error("设置已接入必须填写手机号");
    }
    return updateOaEmailStatus(target, {
        status,
        phone,
        taskId: asString(body.taskId ?? body.bindTaskId),
        sub2apiAccount: asString(body.sub2apiAccount ?? body.bindSub2ApiAccount),
        accessTokenHash: asString(body.accessTokenHash ?? body.bindAccessTokenHash),
        error: asString(body.error ?? body.bindError),
        note: asString(body.note ?? body.bindNote),
    });
}

function getPhoneFromToken(token: string): string {
    const payload = decodeJwt(token);
    const auth = (payload?.["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
    const profile = (payload?.["https://api.openai.com/profile"] ?? {}) as Record<string, unknown>;
    const candidates = [
        profile.phone_number,
        profile.phone,
        auth.phone_number,
        auth.phone,
        payload?.phone_number,
        payload?.phone,
    ];
    for (const item of candidates) {
        const value = String(item ?? "").trim();
        if (value) return value.startsWith("+") ? value : `+${value.replace(/[^\d]/g, "")}`;
    }
    return "";
}

async function createOaSub2ApiTasks(body: Record<string, unknown>): Promise<RegisterTask[]> {
    const concurrency = safeNumber(body.concurrency, 1, 1, 10);
    registerMaxConcurrency = concurrency;

    const ppxy = getPpxyConfig();
    const tokenOut = path.resolve(String(body.tokenOut || ppxy.tokenFile));
    const password = String(body.password || "").trim();
    const config = readConfigSync();
    const rawOaProxyUrl = String(body.oaProxyUrl ?? body.openaiProxyUrl ?? body.proxyUrl ?? "").trim();
    const oaProxyUrl = rawOaProxyUrl.toLowerCase() === "direct"
        ? ""
        : rawOaProxyUrl || getOaProxyUrl(config);
    const removeTokenOnSuccess = Boolean(body.removeTokenOnSuccess);
    const countLimit = safeNumber(body.count, 100, 1, 500);
    const selectedHashes = Array.isArray(body.tokenHashes)
        ? body.tokenHashes.map((item) => String(item).trim()).filter(Boolean)
        : [];
    const emails = (await readOaEmailPool()).filter((item) => item.available);
    if (!emails.length) throw new Error("没有未绑定可用邮箱；请先导入 邮箱-----接码地址 或 邮箱----密码----clientId----refreshToken");

    const tokens = await readTokenPool();
    const tokenItems = tokens
        .map((token) => ({token, hash: tokenHash(token), phone: getPhoneFromToken(token)}))
        .filter((item) => item.phone)
        .filter((item) => atMeta.oa[item.hash]?.enabled !== false)
        .filter((item) => !selectedHashes.length || selectedHashes.includes(item.hash))
        .slice(0, Math.min(countLimit, emails.length));
    if (!tokenItems.length) {
        throw new Error("没有可用的 AT+手机号；请确认 AT 池 token 里能解析 phone_number");
    }

    await assertOaOpenAiReachable(oaProxyUrl);

    const envBase: NodeJS.ProcessEnv = {...process.env};
    envBase.OPENAI_PROXY_URL = oaProxyUrl;
    envBase.DEFAULT_PROXY_URL = oaProxyUrl;
    envBase.SENTINEL_BROWSER_PROXY = oaProxyUrl;
    const created: RegisterTask[] = [];
    for (let i = 0; i < tokenItems.length; i += 1) {
        const tokenItem = tokenItems[i];
        const emailItem = emails[i];
        const id = `oa_${Date.now()}_${randomUUID().slice(0, 8)}`;
        const args = [
            "src/oa-sub2api.ts",
            "--st",
            "--phone", tokenItem.phone,
            "--bind-email", emailItem.email,
            "--email-pool", oaEmailPoolFile,
            "--token-out", tokenOut,
            "--consume-email-pool-on-error",
        ];
        if (emailItem.mailboxUrl) {
            args.push("--mailbox-url", emailItem.mailboxUrl);
        } else {
            args.push("--email-raw", emailItem.raw);
        }
        if (password) {
            args.push("--password", password);
        }
        if (removeTokenOnSuccess) {
            args.push("--remove-token-on-success");
        }

        const task: RuntimeRegisterTask = {
            id,
            kind: "oa-sub2api",
            status: "queued",
            title: `OA ${tokenItem.phone} -> ${emailItem.email}`,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            args,
            tokenOut,
            phone: tokenItem.phone,
            bindEmail: emailItem.email,
            mailboxUrl: emailItem.mailboxUrl,
            emailRaw: emailItem.raw,
            oaProxyUrl: maskUrlSecret(oaProxyUrl),
            sourceAccessTokenHash: tokenItem.hash,
            accessTokenHash: tokenItem.hash,
            accessTokenPreview: tokenPreview(tokenItem.token),
            sub2apiGroup: String(body.sub2apiGroup || asString(config.sub2apiGroupName, "codex")),
            logs: [],
            env: envBase,
        };
        registerTasks.set(id, task);
        registerQueue.push(task);
        setOaEmailStatus(emailItem.email, {
            status: "reserved",
            phone: tokenItem.phone,
            taskId: id,
            accessTokenHash: tokenItem.hash,
            note: "queued oa-sub2api",
        });
        created.push(task);
        appendTaskLog(task, "system", `queued oa-sub2api phone=${tokenItem.phone} bindEmail=${emailItem.email} proxy=${maskUrlSecret(oaProxyUrl) || "direct"}`);
    }
    saveOaEmailStatusLater();
    saveRegisterTasksLater();
    scheduleRegisterTasks();
    return created;
}

function cancelRegisterTask(task: RuntimeRegisterTask): void {
    if (task.status === "queued") {
        registerQueue = registerQueue.filter((item) => item.id !== task.id);
        task.status = "canceled";
        task.finishedAt = nowIso();
        task.updatedAt = task.finishedAt;
        recordOaTaskEmailStatus(task, "canceled");
        appendTaskLog(task, "system", "canceled while queued");
        saveRegisterTasksLater();
        return;
    }
    if (task.status === "running" && task.child) {
        task.status = "canceled";
        task.updatedAt = nowIso();
        recordOaTaskEmailStatus(task, "canceled");
        appendTaskLog(task, "system", "cancel requested");
        void cancelSmsActivationForTask(task).catch((error) => {
            appendTaskLog(task, "system", `sms cancel final failed: ${error instanceof Error ? error.message : String(error)}`);
            saveRegisterTasksLater();
        });
        killProcessTree(task.child);
        saveRegisterTasksLater();
    }
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
    const pid = child.pid;
    if (!pid) {
        child.kill();
        return;
    }
    if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
        });
        killer.on("error", () => child.kill());
        return;
    }
    child.kill("SIGTERM");
}

function base64UrlDecode(input: string): string {
    let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) normalized += "=";
    return Buffer.from(normalized, "base64").toString("utf8");
}

function decodeJwt(token: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
        return JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function tokenInfo(token: string, index: number): Record<string, unknown> {
    const payload = decodeJwt(token);
    const auth = (payload?.["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
    const profile = (payload?.["https://api.openai.com/profile"] ?? {}) as Record<string, unknown>;
    const exp = Number(payload?.exp ?? 0);
    const hash = tokenHash(token);
    const phone = getPhoneFromToken(token);
    const oaMeta = atMeta.oa[hash];
    const oaEligible = Boolean(phone) && oaMeta?.enabled !== false;
    return {
        index,
        hash,
        preview: tokenPreview(token),
        length: token.length,
        email: String(profile.email ?? auth.email ?? ""),
        phone,
        userId: String(auth.user_id ?? payload?.sub ?? ""),
        plan: String(auth.chatgpt_plan_type ?? ""),
        exp,
        expiresAt: exp ? new Date(exp * 1000).toISOString() : "",
        expired: exp ? Date.now() > exp * 1000 : false,
        trial: atMeta.trial[hash],
        oa: {
            enabled: oaMeta?.enabled ?? null,
            eligible: oaEligible,
            mode: oaMeta?.enabled === true ? "enabled" : oaMeta?.enabled === false ? "disabled" : "auto",
            note: oaMeta?.note ?? "",
            updatedAt: oaMeta?.updatedAt ?? "",
        },
    };
}

function tokenFullInfo(token: string, index: number): Record<string, unknown> {
    return {
        ...tokenInfo(token, index),
        token,
    };
}

async function readTokenPool(): Promise<string[]> {
    const filePath = getPpxyConfig().tokenFile;
    try {
        const raw = await readFile(filePath, "utf8");
        return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
        return [];
    }
}

function registerSuccessPhoneFile(tokenFile: string): string {
    return path.join(path.dirname(tokenFile), "pool_phones.txt");
}

async function countNonEmptyLines(filePath: string): Promise<number> {
    try {
        const raw = await readFile(filePath, "utf8");
        return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
    } catch {
        return 0;
    }
}

function registerTokenFileCandidates(): string[] {
    const tasks = Array.from(registerTasks.values())
        .filter((task) => task.kind === "register")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const candidates = [
        ...tasks.map((task) => task.tokenOut).filter(Boolean),
        getPpxyConfig().tokenFile,
    ];
    const seen = new Set<string>();
    return candidates
        .map((filePath) => path.resolve(filePath))
        .filter((filePath) => {
            const key = filePath.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

async function getRegisterSuccessSummary(): Promise<Record<string, unknown>> {
    const explicitPhoneFiles = new Map<string, string>();
    for (const task of registerTasks.values()) {
        if (task.kind !== "register" || !task.tokenOut || !task.successTextFile) continue;
        explicitPhoneFiles.set(path.resolve(task.tokenOut).toLowerCase(), path.resolve(task.successTextFile));
    }

    const files = await Promise.all(registerTokenFileCandidates().map(async (tokenFile) => {
        const phoneFile = explicitPhoneFiles.get(tokenFile.toLowerCase()) ?? registerSuccessPhoneFile(tokenFile);
        return {
            tokenFile,
            phoneFile,
            tokenFileExists: existsSync(tokenFile),
            phoneFileExists: existsSync(phoneFile),
            tokenCount: await countNonEmptyLines(tokenFile),
            phoneCount: await countNonEmptyLines(phoneFile),
        };
    }));
    const primary = files.find((item) => item.phoneCount > 0)
        ?? files.find((item) => item.tokenCount > 0)
        ?? files[0]
        ?? null;
    const registerOnly = Array.from(registerTasks.values()).filter((task) => task.kind === "register");
    const tasksWithCost = registerOnly.filter((task) => typeof task.smsCost === "number" && Number.isFinite(task.smsCost));
    const successfulTasksWithCost = tasksWithCost.filter((task) => task.status === "success");
    const totalSmsCost = tasksWithCost.reduce((sum, task) => sum + (task.smsCost ?? 0), 0);
    const successSmsCost = successfulTasksWithCost.reduce((sum, task) => sum + (task.smsCost ?? 0), 0);
    return {
        primary,
        files,
        successfulTasks: registerOnly.filter((task) => task.status === "success").length,
        failedTasks: registerOnly.filter((task) => task.status === "failed").length,
        running: runningTaskCount("register"),
        queued: registerQueue.filter((task) => task.kind === "register").length,
        smsCost: {
            currency: "USD",
            total: Number(totalSmsCost.toFixed(6)),
            success: Number(successSmsCost.toFixed(6)),
            recordedTasks: tasksWithCost.length,
            successfulRecordedTasks: successfulTasksWithCost.length,
        },
    };
}

async function buildRegisterSuccessExport(): Promise<{text: string; fileName: string}> {
    const summary = await getRegisterSuccessSummary();
    const files = Array.isArray(summary.files)
        ? summary.files as Array<{
            tokenFile: string;
            phoneFile: string;
            tokenFileExists: boolean;
            phoneFileExists: boolean;
            tokenCount: number;
            phoneCount: number;
        }>
        : [];
    const phoneSource = files.find((item) => item.phoneCount > 0)
        ?? files.find((item) => item.phoneFileExists);
    if (phoneSource?.phoneFile) {
        try {
            return {
                text: await readFile(phoneSource.phoneFile, "utf8"),
                fileName: "register_success_phone_tokens.txt",
            };
        } catch {
            // Fallback to token file below.
        }
    }

    const tokenSource = files.find((item) => item.tokenCount > 0)
        ?? files.find((item) => item.tokenFileExists);
    if (tokenSource?.tokenFile) {
        try {
            return {
                text: await readFile(tokenSource.tokenFile, "utf8"),
                fileName: "register_success_tokens.txt",
            };
        } catch {
            // Return an empty export if the file disappeared between summary and read.
        }
    }
    return {text: "", fileName: "register_success_empty.txt"};
}

async function writeTokenPool(tokens: string[]): Promise<void> {
    const filePath = getPpxyConfig().tokenFile;
    await mkdir(path.dirname(filePath), {recursive: true});
    await writeFile(filePath, tokens.length ? `${tokens.join("\n")}\n` : "", "utf8");
}

function extractTokens(raw: string): string[] {
    const matches = raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
    const loose = raw
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter((item) => item.split(".").length >= 3 && item.startsWith("eyJ"));
    return Array.from(new Set([...matches, ...loose]));
}

async function importTokens(raw: string): Promise<{added: number; skipped: number; total: number}> {
    const incoming = extractTokens(raw);
    const existing = await readTokenPool();
    const seen = new Set(existing.map(tokenHash));
    const added: string[] = [];
    for (const token of incoming) {
        const hash = tokenHash(token);
        if (seen.has(hash)) continue;
        seen.add(hash);
        added.push(token);
    }
    if (added.length) {
        await writeTokenPool([...existing, ...added]);
    }
    return {added: added.length, skipped: incoming.length - added.length, total: existing.length + added.length};
}

async function removeTokenByHash(hash: string): Promise<boolean> {
    const tokens = await readTokenPool();
    const next = tokens.filter((token) => tokenHash(token) !== hash);
    if (next.length === tokens.length) return false;
    await writeTokenPool(next);
    return true;
}

async function findTokenByHash(hash: string): Promise<string | null> {
    const tokens = await readTokenPool();
    return tokens.find((token) => tokenHash(token) === hash) ?? null;
}

async function updateAtOaMeta(hash: string, body: Record<string, unknown>): Promise<AtOaRecord> {
    if (!await findTokenByHash(hash)) {
        throw new Error("token not found");
    }
    const raw = String(body.enabled ?? body.oaEnabled ?? body.mode ?? "").trim().toLowerCase();
    let enabled: boolean | null;
    if (!raw || raw === "auto" || raw === "null") {
        enabled = null;
    } else if (["1", "true", "yes", "enabled", "on"].includes(raw)) {
        enabled = true;
    } else if (["0", "false", "no", "disabled", "off"].includes(raw)) {
        enabled = false;
    } else {
        throw new Error("oaEnabled must be auto/true/false");
    }
    const record: AtOaRecord = {
        enabled,
        note: String(body.note ?? "").trim(),
        updatedAt: nowIso(),
    };
    atMeta.oa[hash] = record;
    await saveAtMeta();
    return record;
}

async function ppxyFetch(pathname: string, init: RequestInit = {}): Promise<{status: number; data: unknown; text: string}> {
    const cfg = getPpxyConfig();
    if (!cfg.apiKey) {
        throw new Error("PPXY_API_KEY is missing. Set env or ppxy-env.cmd first.");
    }
    const url = `${cfg.baseUrl}${pathname}`;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${cfg.apiKey}`);
    headers.set("Accept", "application/json");
    const response = await fetch(url, {...init, headers});
    const text = await response.text();
    let data: unknown = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = {raw: text};
    }
    if (!response.ok) {
        throw new Error(`PPXY ${pathname} failed: status=${response.status} body=${text.slice(0, 500)}`);
    }
    return {status: response.status, data, text};
}

async function checkTrialForToken(token: string, proxyJp?: string): Promise<TrialResult> {
    const cfg = getPpxyConfig();
    try {
        const payload: Record<string, unknown> = {token};
        if (proxyJp || cfg.proxyJp) payload.proxy_jp = proxyJp || cfg.proxyJp;
        const result = await ppxyFetch("/api/v1/trial/check", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload),
        });
        const data = result.data as Record<string, unknown>;
        return {
            checkedAt: nowIso(),
            ok: Boolean(data.ok ?? true),
            status: String(data.status ?? ""),
            eligible: typeof data.eligible === "boolean" ? data.eligible : undefined,
            result_code: String(data.result_code ?? ""),
            message: String(data.message ?? ""),
            amount_cents: typeof data.amount_cents === "number" ? data.amount_cents : undefined,
            currency: String(data.currency ?? ""),
            raw: data,
        };
    } catch (error) {
        return {
            checkedAt: nowIso(),
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function createPlusJob(body: Record<string, unknown>): Promise<PlusJobRecord> {
    const cfg = getPpxyConfig();
    let token = typeof body.token === "string" ? body.token.trim() : "";
    const tokenHashFromBody = typeof body.tokenHash === "string" ? body.tokenHash.trim() : "";
    if (!token && tokenHashFromBody) {
        token = await findTokenByHash(tokenHashFromBody) ?? "";
    }
    if (!token) throw new Error("missing access token");

    const paypalPhone = String(body.paypalPhone || body.phone || "").trim();
    if (!paypalPhone) throw new Error("missing PayPal phone");

    const clientRef = String(body.clientRef || `web-plus-${Date.now()}-${randomUUID().slice(0, 8)}`);
    const payload: Record<string, unknown> = {
        input: token,
        client_ref: clientRef,
        phone: paypalPhone,
    };

    const optionalMap: Array<[string, string]> = [
        ["smsApi", "sms_api"],
        ["otp", "otp"],
        ["callbackUrl", "callback_url"],
        ["proxy", "proxy"],
        ["proxyJp", "proxy_jp"],
        ["email", "email"],
    ];
    for (const [from, to] of optionalMap) {
        const value = body[from];
        if (typeof value === "string" && value.trim()) payload[to] = value.trim();
    }
    if (!payload.proxy_jp && cfg.proxyJp) payload.proxy_jp = cfg.proxyJp;
    if (body.pplinkRetry !== undefined) payload.pplink_retry = safeNumber(body.pplinkRetry, 3, 0, 10);
    if (body.otpTimeout !== undefined) payload.otp_timeout = safeNumber(body.otpTimeout, 30, 5, 900);

    const response = await ppxyFetch("/api/v1/jobs", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": clientRef,
        },
        body: JSON.stringify(payload),
    });
    const data = response.data as Record<string, unknown>;
    const jobId = String(data.job_id ?? data.id ?? "");
    if (!jobId) throw new Error(`PPXY did not return job_id: ${response.text.slice(0, 300)}`);

    const hash = tokenHash(token);
    const info = tokenInfo(token, 0);
    const record: PlusJobRecord = {
        localId: `plus_${Date.now()}_${randomUUID().slice(0, 8)}`,
        jobId,
        status: String(data.status ?? "queued"),
        clientRef,
        tokenHash: tokenHashFromBody || hash,
        tokenPreview: tokenPreview(token),
        tokenPhone: String(info.phone ?? ""),
        tokenEmail: String(info.email ?? ""),
        paypalPhone,
        request: redactPayload(payload),
        response: data,
        latest: data,
        resultCode: String(data.result_code ?? ""),
        billingStatus: String(data.billing_status ?? ""),
        otpPending: Boolean(data.otp_pending ?? data.status === "otp_pending"),
        done: Boolean(data.done ?? false),
        removeTokenOnSuccess: Boolean(body.removeTokenOnSuccess),
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    plusJobs.set(record.localId, record);
    await savePlusJobs();
    startPlusPolling(record.localId);
    return record;
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const copy = {...payload};
    if (typeof copy.input === "string") copy.input = tokenPreview(copy.input);
    return copy;
}

function applyPlusLatest(record: PlusJobRecord, data: Record<string, unknown>): void {
    record.latest = data;
    record.status = String(data.status ?? record.status);
    record.resultCode = String(data.result_code ?? record.resultCode ?? "");
    record.errorMessage = String(data.error_message ?? record.errorMessage ?? "");
    record.billingStatus = String(data.billing_status ?? record.billingStatus ?? "");
    record.otpPending = Boolean(data.otp_pending ?? record.status === "otp_pending");
    record.done = Boolean(data.done ?? ["success", "failed"].includes(record.status));
    record.updatedAt = nowIso();
}

async function refreshPlusJob(record: PlusJobRecord): Promise<PlusJobRecord> {
    if (!record.jobId) return record;
    try {
        const result = await ppxyFetch(`/api/v1/jobs/${encodeURIComponent(record.jobId)}`);
        applyPlusLatest(record, result.data as Record<string, unknown>);
        if (record.done && record.status === "success" && record.removeTokenOnSuccess && record.tokenHash) {
            await removeTokenByHash(record.tokenHash);
        }
    } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        record.updatedAt = nowIso();
    }
    await savePlusJobs();
    return record;
}

function startPlusPolling(localId: string): void {
    if (pollingPlusJobs.has(localId)) return;
    pollingPlusJobs.add(localId);
    void (async () => {
        try {
            for (;;) {
                const record = plusJobs.get(localId);
                if (!record || record.done) return;
                await refreshPlusJob(record);
                const next = plusJobs.get(localId);
                if (!next || next.done) return;
                await new Promise((resolve) => setTimeout(resolve, 5000));
            }
        } finally {
            pollingPlusJobs.delete(localId);
        }
    })();
}

function findPlusJob(id: string): PlusJobRecord | undefined {
    return plusJobs.get(id) ?? Array.from(plusJobs.values()).find((job) => job.jobId === id);
}

function isPlusJobSuccess(record: PlusJobRecord): boolean {
    const latest = record.latest as Record<string, unknown> | undefined;
    const result = latest?.result as Record<string, unknown> | undefined;
    return record.status.toLowerCase() === "success"
        || record.resultCode?.toUpperCase() === "SUCCESS"
        || Boolean(result?.success);
}

async function submitPlusOtp(record: PlusJobRecord, pin: string): Promise<unknown> {
    if (!pin.trim()) throw new Error("missing otp");
    const result = await ppxyFetch(`/api/v1/jobs/${encodeURIComponent(record.jobId)}/otp`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({pin: pin.trim()}),
    });
    record.response = result.data;
    record.updatedAt = nowIso();
    await savePlusJobs();
    startPlusPolling(record.localId);
    return result.data;
}

async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (size > 10 * 1024 * 1024) throw new Error("request body too large");
        chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const raw = await readBody(req);
    if (!raw.trim()) return {};
    return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
    const body = JSON.stringify(value, null, 2);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
}

function sendText(res: ServerResponse, status: number, text: string, contentType = "text/plain; charset=utf-8"): void {
    res.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
}

function sendTextDownload(
    res: ServerResponse,
    status: number,
    text: string,
    fileName: string,
    contentType = "text/plain; charset=utf-8",
): void {
    const safeFileName = fileName.replace(/[^\w.-]/g, "_") || "download.txt";
    res.writeHead(status, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${safeFileName}"`,
        "Content-Length": Buffer.byteLength(text),
    });
    res.end(text);
}

async function readAgentDoc(filePath: string): Promise<{path: string; content: string}> {
    return {
        path: filePath,
        content: await readFile(filePath, "utf8"),
    };
}

async function sendAgentDocs(res: ServerResponse): Promise<void> {
    const [quick, full] = await Promise.all([
        readAgentDoc(agentQuickDocFile),
        readAgentDoc(agentFullDocFile),
    ]);
    sendJson(res, 200, {
        quick: {
            title: "AI 快速接入阅读文档",
            ...quick,
        },
        full: {
            title: "AI 完整能力接入手册",
            ...full,
        },
        readOrder: [
            agentQuickDocFile,
            agentFullDocFile,
        ],
        agentPrompt: [
            "你是接入本系统的自动化智能体。",
            `第一步读取快速接入文档：${agentQuickDocFile}`,
            `第二步读取完整能力文档：${agentFullDocFile}`,
            "先理解健康检查、任务状态、手机号注册、AT 升级、OA 接入的 API，再按用户目标调用本地 Web API 操作。",
        ].join("\n"),
    });
}

async function serveStatic(url: URL, res: ServerResponse): Promise<boolean> {
    const routes: Record<string, string> = {
        "/": "index.html",
        "/register": "register.html",
        "/plus": "plus.html",
        "/oa": "oa.html",
        "/styles.css": "styles.css",
        "/theme.js": "theme.js",
        "/agent.js": "agent.js",
        "/register.js": "register.js",
        "/plus.js": "plus.js",
        "/oa.js": "oa.js",
    };
    const target = routes[url.pathname];
    if (!target) return false;
    const filePath = path.join(webDir, target);
    if (!existsSync(filePath)) return false;
    const ext = path.extname(filePath);
    const contentType = ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
            ? "text/css; charset=utf-8"
            : "application/javascript; charset=utf-8";
    sendText(res, 200, await readFile(filePath, "utf8"), contentType);
    return true;
}

function publicTask(task: RuntimeRegisterTask): RegisterTask {
    const {child: _child, env: _env, ...plain} = task;
    return {...plain, args: redactCliArgs(plain.args), logs: plain.logs.slice(-200)};
}

function runningTaskCount(kind?: TaskKind): number {
    return Array.from(registerTasks.values())
        .filter((task) => task.status === "running")
        .filter((task) => !kind || task.kind === kind)
        .length;
}

async function deleteRegisterTasksByStatus(statuses: Set<TaskStatus>): Promise<Record<string, unknown>> {
    const targets = Array.from(registerTasks.values())
        .filter((task) => task.kind === "register")
        .filter((task) => statuses.has(task.status))
        .filter((task) => task.status !== "running");
    const deleted: string[] = [];
    for (const task of targets) {
        registerQueue = registerQueue.filter((item) => item.id !== task.id);
        registerTasks.delete(task.id);
        try {
            await unlink(taskLogPath(task.id));
        } catch {
            // log file may not exist
        }
        deleted.push(task.id);
    }
    if (deleted.length) saveRegisterTasksLater();
    return {deleted: deleted.length, ids: deleted};
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const pathname = url.pathname;
    const ppxy = getPpxyConfig();

    if (method === "GET" && pathname === "/api/agent/docs") {
        await sendAgentDocs(res);
        return;
    }

    if (method === "GET" && pathname === "/api/health") {
        const tokens = await readTokenPool();
        sendJson(res, 200, {
            ok: true,
            rootDir,
            appDir,
            tokenFile: ppxy.tokenFile,
            ppxy: {
                baseUrl: ppxy.baseUrl,
                apiKeyPresent: Boolean(ppxy.apiKey),
                apiKeyMasked: maskSecret(ppxy.apiKey),
                proxyJpPresent: Boolean(ppxy.proxyJp),
            },
            counts: {
                at: tokens.length,
                oaEmails: (await readOaEmailPool()).length,
                oaTasks: Array.from(registerTasks.values()).filter((task) => task.kind === "oa-sub2api").length,
                registerTasks: registerTasks.size,
                plusJobs: plusJobs.size,
                registerRunning: runningTaskCount("register"),
                registerQueued: registerQueue.length,
            },
            config: getConfigSummary(),
        });
        return;
    }

    if (method === "GET" && pathname === "/api/config") {
        sendJson(res, 200, getConfigSummary());
        return;
    }

    if (method === "GET" && pathname === "/api/register/password") {
        sendJson(res, 200, getRegisterPasswordView());
        return;
    }

    if ((method === "PATCH" || method === "POST") && pathname === "/api/register/password") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await updateRegisterPassword(body));
        return;
    }

    if ((method === "PATCH" || method === "POST") && pathname === "/api/config/sms") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await updateSmsConfig(body));
        return;
    }

    if (method === "GET" && pathname === "/api/sms/prices") {
        sendJson(res, 200, await getSmsPlatformPrices(url.searchParams));
        return;
    }

    if (method === "GET" && pathname === "/api/sms/countries") {
        sendJson(res, 200, await getSmsCountries(url.searchParams));
        return;
    }

    if ((method === "PATCH" || method === "POST") && pathname === "/api/config/sub2api") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await updateSub2ApiConfig(body));
        return;
    }

    if ((method === "PATCH" || method === "POST") && pathname === "/api/config/mail-api") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await updateMailApiConfig(body));
        return;
    }

    if ((method === "PATCH" || method === "POST") && pathname === "/api/config/oa-proxy") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await updateOaProxyConfig(body));
        return;
    }

    if (method === "GET" && pathname === "/api/oa/probe") {
        sendJson(res, 200, await probeOpenAiAuth(url.searchParams));
        return;
    }

    if (method === "GET" && pathname === "/api/register/success") {
        sendJson(res, 200, await getRegisterSuccessSummary());
        return;
    }

    if (method === "GET" && pathname === "/api/register/success/export") {
        const exported = await buildRegisterSuccessExport();
        sendTextDownload(res, 200, exported.text, exported.fileName);
        return;
    }

    if (method === "GET" && pathname === "/api/register/tasks") {
        sendJson(res, 200, {
            tasks: Array.from(registerTasks.values()).filter((task) => task.kind === "register").map(publicTask).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            running: runningTaskCount("register"),
            queued: registerQueue.filter((task) => task.kind === "register").length,
            concurrency: registerMaxConcurrency,
        });
        return;
    }

    if (method === "POST" && pathname === "/api/register/tasks") {
        const body = await readJsonBody(req);
        const tasks = createRegisterTasks(body).map((task) => publicTask(task as RuntimeRegisterTask));
        sendJson(res, 201, {tasks});
        return;
    }

    if (method === "DELETE" && pathname === "/api/register/tasks") {
        const statusParam = url.searchParams.get("status") ?? url.searchParams.get("statuses") ?? "";
        const requested = statusParam.split(",").map((item) => item.trim()).filter(Boolean);
        const allowedStatuses: TaskStatus[] = ["queued", "failed", "canceled"];
        const statuses = new Set<TaskStatus>(
            (requested.length ? requested : ["failed"])
                .filter((item): item is TaskStatus => allowedStatuses.includes(item as TaskStatus)),
        );
        if (!statuses.size) {
            sendJson(res, 400, {error: "no deletable statuses selected"});
            return;
        }
        sendJson(res, 200, await deleteRegisterTasksByStatus(statuses));
        return;
    }

    if (method === "GET" && pathname === "/api/oa/emails") {
        const items = await readOaEmailPool();
        sendJson(res, 200, {file: oaEmailPoolFile, count: items.length, items});
        return;
    }

    if (method === "POST" && pathname === "/api/oa/emails/import") {
        try {
            const body = await readJsonBody(req);
            const filePath = String(body.filePath ?? "").trim();
            let text = String(body.text ?? "");
            if (filePath) {
                const resolved = path.resolve(filePath);
                text = await readFile(resolved, "utf8");
            }
            sendJson(res, 200, await importOaEmails(text, String(body.mailApiBaseUrl ?? "")));
        } catch (error) {
            sendJson(res, 400, {error: error instanceof Error ? error.message : String(error)});
        }
        return;
    }

    if (method === "POST" && pathname === "/api/oa/emails/rebase") {
        try {
            const body = await readJsonBody(req);
            sendJson(res, 200, await rebaseOaEmailMailboxUrls(String(body.mailApiBaseUrl ?? body.baseUrl ?? "")));
        } catch (error) {
            sendJson(res, 400, {error: error instanceof Error ? error.message : String(error)});
        }
        return;
    }

    const oaEmailMatch = pathname.match(/^\/api\/oa\/emails\/(.+)$/);
    if (oaEmailMatch && (method === "PATCH" || method === "POST")) {
        try {
            const body = await readJsonBody(req);
            sendJson(res, 200, {status: await patchOaEmailStatus(decodeURIComponent(oaEmailMatch[1]), body)});
        } catch (error) {
            sendJson(res, 400, {error: error instanceof Error ? error.message : String(error)});
        }
        return;
    }

    if (oaEmailMatch && method === "DELETE") {
        sendJson(res, 200, {removed: await removeOaEmail(decodeURIComponent(oaEmailMatch[1]))});
        return;
    }

    if (method === "GET" && pathname === "/api/oa/tasks") {
        sendJson(res, 200, {
            tasks: Array.from(registerTasks.values()).filter((task) => task.kind === "oa-sub2api").map(publicTask).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            running: runningTaskCount("oa-sub2api"),
            queued: registerQueue.filter((task) => task.kind === "oa-sub2api").length,
            concurrency: registerMaxConcurrency,
        });
        return;
    }

    if (method === "POST" && pathname === "/api/oa/tasks") {
        try {
            const body = await readJsonBody(req);
            const tasks = (await createOaSub2ApiTasks(body)).map((task) => publicTask(task as RuntimeRegisterTask));
            sendJson(res, 201, {tasks});
        } catch (error) {
            const payload: Record<string, unknown> = {error: error instanceof Error ? error.message : String(error)};
            if (error instanceof Error && "probe" in error) {
                payload.probe = (error as Error & {probe?: Record<string, unknown>}).probe;
            }
            sendJson(res, 400, payload);
        }
        return;
    }

    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(cancel))?$/);
    if (taskMatch) {
        const task = registerTasks.get(decodeURIComponent(taskMatch[1]));
        if (!task) {
            sendJson(res, 404, {error: "task not found"});
            return;
        }
        if (method === "POST" && taskMatch[2] === "cancel") {
            cancelRegisterTask(task);
            sendJson(res, 200, {task: publicTask(task)});
            return;
        }
        if (method === "GET" && !taskMatch[2]) {
            sendJson(res, 200, {task: publicTask(task)});
            return;
        }
        if (method === "DELETE" && !taskMatch[2]) {
            if (task.status === "running") {
                sendJson(res, 409, {error: "running task cannot be deleted, cancel it first"});
                return;
            }
            registerQueue = registerQueue.filter((item) => item.id !== task.id);
            registerTasks.delete(task.id);
            try {
                await unlink(taskLogPath(task.id));
            } catch {
                // log file may not exist
            }
            saveRegisterTasksLater();
            sendJson(res, 200, {deleted: true});
            return;
        }
    }

    if (method === "GET" && pathname === "/api/ats") {
        const tokens = await readTokenPool();
        sendJson(res, 200, {
            tokenFile: ppxy.tokenFile,
            items: tokens.map(tokenInfo),
        });
        return;
    }

    if (method === "GET" && pathname === "/api/ats/full") {
        const tokens = await readTokenPool();
        sendJson(res, 200, {
            tokenFile: ppxy.tokenFile,
            items: tokens.map(tokenFullInfo),
        });
        return;
    }

    if (method === "POST" && pathname === "/api/ats/import") {
        const body = await readJsonBody(req);
        const result = await importTokens(String(body.text ?? ""));
        sendJson(res, 200, result);
        return;
    }

    const atMatch = pathname.match(/^\/api\/ats\/([^/]+)(?:\/(check-trial))?$/);
    if (atMatch) {
        const hash = decodeURIComponent(atMatch[1]);
        if (method === "DELETE" && !atMatch[2]) {
            sendJson(res, 200, {removed: await removeTokenByHash(hash)});
            return;
        }
        if (method === "POST" && atMatch[2] === "check-trial") {
            const token = await findTokenByHash(hash);
            if (!token) {
                sendJson(res, 404, {error: "token not found"});
                return;
            }
            const body = await readJsonBody(req);
            const trial = await checkTrialForToken(token, typeof body.proxyJp === "string" ? body.proxyJp : undefined);
            atMeta.trial[hash] = trial;
            await saveAtMeta();
            sendJson(res, 200, {trial});
            return;
        }
        if ((method === "PATCH" || method === "POST") && !atMatch[2]) {
            try {
                const body = await readJsonBody(req);
                sendJson(res, 200, {oa: await updateAtOaMeta(hash, body)});
            } catch (error) {
                sendJson(res, 400, {error: error instanceof Error ? error.message : String(error)});
            }
            return;
        }
    }

    if (method === "POST" && pathname === "/api/ats/check-trial") {
        const body = await readJsonBody(req);
        const token = String(body.token || "").trim();
        if (!token) {
            sendJson(res, 400, {error: "missing token"});
            return;
        }
        const trial = await checkTrialForToken(token, typeof body.proxyJp === "string" ? body.proxyJp : undefined);
        sendJson(res, 200, {trial});
        return;
    }

    if (method === "GET" && pathname === "/api/plus/account") {
        const result = await ppxyFetch("/api/v1/account");
        sendJson(res, 200, result.data);
        return;
    }

    if (method === "GET" && pathname === "/api/plus/jobs") {
        sendJson(res, 200, {
            jobs: Array.from(plusJobs.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        });
        return;
    }

    if (method === "POST" && pathname === "/api/plus/jobs") {
        const body = await readJsonBody(req);
        const job = await createPlusJob(body);
        sendJson(res, 201, {job});
        return;
    }

    const plusMatch = pathname.match(/^\/api\/plus\/jobs\/([^/]+)(?:\/(refresh|otp))?$/);
    if (plusMatch) {
        const record = findPlusJob(decodeURIComponent(plusMatch[1]));
        if (!record) {
            sendJson(res, 404, {error: "plus job not found"});
            return;
        }
        const action = plusMatch[2] ?? "";
        if (method === "GET" && !action) {
            sendJson(res, 200, {job: await refreshPlusJob(record)});
            return;
        }
        if (method === "POST" && action === "refresh") {
            sendJson(res, 200, {job: await refreshPlusJob(record)});
            return;
        }
        if (method === "POST" && action === "otp") {
            const body = await readJsonBody(req);
            const data = await submitPlusOtp(record, String(body.pin || body.otp || ""));
            sendJson(res, 200, {result: data, job: record});
            return;
        }
        if (method === "DELETE" && !action) {
            if (isPlusJobSuccess(record)) {
                sendJson(res, 409, {error: "successful plus job cannot be deleted"});
                return;
            }
            plusJobs.delete(record.localId);
            await savePlusJobs();
            sendJson(res, 200, {deleted: true});
            return;
        }
    }

    sendJson(res, 404, {error: "not found"});
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
        if (url.pathname.startsWith("/api/")) {
            await handleApi(req, res, url);
            return;
        }
        if (await serveStatic(url, res)) return;
        sendText(res, 404, "not found");
    } catch (error) {
        sendJson(res, 500, {error: error instanceof Error ? error.message : String(error)});
    }
}

async function main(): Promise<void> {
    await loadStores();
    const preferredPort = safeNumber(process.env.PORT, 8787, 1, 65535);
    const host = process.env.HOST || "127.0.0.1";
    const server = http.createServer((req, res) => {
        void handleRequest(req, res);
    });
    const port = await listenWithFallback(server, host, preferredPort, Boolean(process.env.PORT));
    console.log(`web server listening: http://${host}:${port}/`);
    console.log(`register page: http://${host}:${port}/register`);
    console.log(`plus page: http://${host}:${port}/plus`);
    console.log(`oa page: http://${host}:${port}/oa`);
}

async function listenWithFallback(
    server: http.Server,
    host: string,
    preferredPort: number,
    fixedPort: boolean,
): Promise<number> {
    const maxAttempts = fixedPort ? 1 : 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const port = preferredPort + attempt;
        try {
            await new Promise<void>((resolve, reject) => {
                const onError = (error: NodeJS.ErrnoException) => {
                    server.off("listening", onListening);
                    reject(error);
                };
                const onListening = () => {
                    server.off("error", onError);
                    resolve();
                };
                server.once("error", onError);
                server.once("listening", onListening);
                server.listen(port, host);
            });
            return port;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt === maxAttempts - 1) {
                throw error;
            }
            console.warn(`port ${port} is in use, trying ${port + 1}`);
        }
    }
    throw new Error("no available port");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
