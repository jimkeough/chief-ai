import ConfigClient from "../ConfigClient";

// Config → Connections: email plus direct MCP connections.
export const dynamic = "force-dynamic";

export default function ConfigConnectionsPage() {
  return <ConfigClient section="connections" />;
}
