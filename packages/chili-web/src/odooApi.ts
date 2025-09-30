// See CHANGELOG.md for modifications (updated 2025-09-30)
let token: string | undefined;

class ApiError extends Error {
    code?: string;
    status?: number;
    constructor(message: string, code?: string, status?: number) {
        super(message);
        this.name = "ApiError";
        this.code = code;
        this.status = status;
    }
}

async function parse(response: Response) {
    const data = await response.json();
    return data && (data as any).result ? (data as any).result : data;
}

async function doPost(url: string, body?: unknown, useToken?: boolean) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (useToken && token) headers["X-CHILI-TOKEN"] = token;
    const rpcBody = { jsonrpc: "2.0", params: body || {} };
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(rpcBody) });
    const payload = await parse(res);
    if (payload && payload.ok === false) {
        throw new ApiError(payload.message || payload.code || "Error", payload.code || "ERROR", 200);
    }
    return payload;
}

export const ChiliOdoo = {
    async bootstrap() {
        const res = await doPost("/self-checkout/api/bootstrap", {});
        token = (res as any).token;
        return res;
    },

    async quote(payload?: unknown) {
        if (!token) await this.bootstrap();

        try {
            return await doPost("/self-checkout/api/quote", payload, true);
        } catch (e: any) {
            if (e?.code === "UNAUTHORIZED") {
                await this.bootstrap();
                return await doPost("/self-checkout/api/quote", payload, true);
            }
            throw e;
        }
    },

    async checkout(payload?: unknown) {
        if (!token) await this.bootstrap();
        try {
            return await doPost("/self-checkout/api/checkout", payload, true);
        } catch (e: any) {
            if (e?.code === "UNAUTHORIZED") {
                await this.bootstrap();
                return await doPost("/self-checkout/api/checkout", payload, true);
            }
            throw e;
        }
    },

    async materials() {
        if (!token) await this.bootstrap();

        try {
            return await doPost("/self-checkout/api/materials", {}, true);
        } catch (e: any) {
            if (e?.code === "UNAUTHORIZED") {
                await this.bootstrap();
                return await doPost("/self-checkout/api/materials", {}, true);
            }
            throw e;
        }
    },
};
