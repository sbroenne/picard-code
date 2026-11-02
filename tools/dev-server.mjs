import { createServer } from "vite";

/** Keeps the browser on one local address while forwarding the real app's API. */
export async function startDevelopmentServer(target) {
  const backend = new URL(target);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.username || backend.password
    || backend.pathname !== "/" || backend.search || backend.hash) {
    throw new Error("The development server needs the app's local HTTP address.");
  }
  let origin;
  const allowed = (request, websocket = false) => !!origin && request.headers.host === new URL(origin).host
    && (!request.headers.origin ? !websocket : request.headers.origin === origin)
    && (!request.headers["sec-fetch-site"] || (websocket ? ["same-origin"] : ["same-origin", "none"]).includes(request.headers["sec-fetch-site"]));
  const forward = (proxyRequest, request) => {
    if (request.headers.origin) proxyRequest.setHeader("Origin", backend.origin);
  };
  const server = await createServer({
    server: {
      host: "127.0.0.1",
      port: 0,
      cors: false,
      proxy: {
        "/api/": {
          target: backend.origin,
          changeOrigin: true,
          ws: true,
          configure(proxy) {
            proxy.on("proxyReq", forward);
            proxy.on("proxyReqWs", (proxyRequest, request) => {
              if (!allowed(request, true)) { proxyRequest.destroy(); return; }
              forward(proxyRequest, request);
            });
          },
        },
      },
    },
    plugins: [{
      name: "picard-local-development",
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (!allowed(request)) {
            response.writeHead(403);
            response.end("Open the local address printed by Picard Code.");
            return;
          }
          next();
        });
        vite.httpServer.prependListener("upgrade", (request, socket) => {
          if (!allowed(request, true)) {
            socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          }
        });
      },
    }],
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("The development server did not start.");
    origin = `http://127.0.0.1:${address.port}`;
    return { origin, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
}
