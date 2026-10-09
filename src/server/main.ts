import { startServer } from "./server";

const server = startServer({ dir: "./diagrams", port: 3000 });
console.log(`listening on ${server.url}`);
