import { describe, expect, it } from "vitest";
import { readBody, readForm, readJson } from "./body";

/** A chunked upload: no Content-Length, `chunks` pieces of `size` bytes, counting how many were pulled. */
function streamed(chunks: number, size: number) {
  const pulled = { n: 0 };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (pulled.n === chunks) return c.close();
        pulled.n++;
        c.enqueue(new Uint8Array(size).fill(120));
      },
    },
    { highWaterMark: 0 },
  );
  return { req: new Request("https://storm.test/x", { method: "POST", body, duplex: "half" } as RequestInit), pulled };
}

describe("request bodies", () => {
  it("refuses a declared Content-Length over the cap without reading the body", async () => {
    const { req, pulled } = streamed(10, 1024);
    req.headers.set("content-length", String(10 * 1024));
    const res = (await readBody(req, 4096, "Too big for this")) as Response;
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Too big for this" });
    expect(pulled.n).toBe(0);
  });

  it("stops reading a body without a length as soon as it's over the cap", async () => {
    const { req, pulled } = streamed(1000, 1024);
    expect(((await readBody(req, 4096)) as Response).status).toBe(413);
    expect(pulled.n).toBeLessThan(10);
  });

  it("returns bodies under the cap", async () => {
    const { req } = streamed(4, 1024);
    expect(((await readBody(req, 4096)) as Uint8Array).byteLength).toBe(4096);
    expect(await readBody(new Request("https://storm.test/x"), 10)).toEqual(new Uint8Array());
  });

  it("parses JSON, null when it isn't, 413 when it's too big", async () => {
    const post = (body: string) => new Request("https://storm.test/x", { method: "POST", body });
    expect(await readJson(post('{"identifier":"bob"}'))).toEqual({ identifier: "bob" });
    expect(await readJson(post("{nope"))).toBeNull();
    expect(await readJson(post(""))).toBeNull();
    expect(((await readJson(post(JSON.stringify({ password: "x".repeat(20_000) })))) as Response).status).toBe(413);
  });

  it("parses multipart forms under the cap", async () => {
    const form = new FormData();
    form.set("body", "Hail");
    form.set("image", new Blob([new Uint8Array(2000)], { type: "image/png" }), "a.png");
    const post = () => new Request("https://storm.test/x", { method: "POST", body: form });
    const read = (await readForm(post(), 8192)) as FormData;
    expect(read.get("body")).toBe("Hail");
    expect((read.get("image") as File).size).toBe(2000);
    expect(((await readForm(post(), 1024)) as Response).status).toBe(413);
    expect(await readForm(new Request("https://storm.test/x", { method: "POST", body: "a=1", headers: { "content-type": "multipart/form-data; boundary=x" } }), 1024)).toBeNull();
  });
});
