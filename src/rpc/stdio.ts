export type RpcHandler = (msg: any) => Promise<void> | void;

export function startStdioRpc(handler: RpcHandler) {
  let buf = Buffer.alloc(0), len = -1;

  const write = (obj: any) => {
    const b = Buffer.from(JSON.stringify(obj), "utf8");
    process.stdout.write(`Content-Length: ${b.length}\r\n\r\n`);
    process.stdout.write(b);
  };

  process.stdin.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (len < 0) {
        const sep = buf.indexOf("\r\n\r\n");
        if (sep < 0) break;
        const header = buf.subarray(0, sep).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) throw new Error("Missing Content-Length");
        len = parseInt(m[1], 10);
        buf = buf.subarray(sep + 4);
      }
      if (buf.length < len) break;
      const body = buf.subarray(0, len);
      buf = buf.subarray(len);
      len = -1;
      handler(JSON.parse(body.toString("utf8")));
    }
  });

  return { write };
}