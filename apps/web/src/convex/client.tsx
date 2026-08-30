import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { useAuth } from "@workos-inc/authkit-react";
import { ConvexReactClient } from "convex/react";
import {
  createContext,
  useEffect,
  useMemo,
  useState,
  use,
  type ReactNode,
} from "react";
import type { ProductionRuntimeConfig } from "../config/runtime";

const ClientContext = createContext<ConvexReactClient | null>(null);

export function ConvexSessionProvider({
  config,
  children,
}: {
  config: ProductionRuntimeConfig;
  children: ReactNode;
}) {
  const client = useMemo(
    () =>
      new ConvexReactClient(config.convexUrl, {
        skipConvexDeploymentUrlCheck: true,
        unsavedChangesWarning: false,
      }),
    [config.convexUrl],
  );
  useEffect(() => () => void client.close(), [client]);
  return (
    <ClientContext.Provider value={client}>
      <ConvexProviderWithAuthKit client={client} useAuth={useAuth}>
        {children}
      </ConvexProviderWithAuthKit>
    </ClientContext.Provider>
  );
}

export function useConvexClient(): ConvexReactClient {
  const client = use(ClientContext);
  if (!client) throw new Error("ConvexSessionProvider is missing.");
  return client;
}

export function useConnectionState() {
  const client = useConvexClient();
  const [state, setState] = useState(() => client.connectionState());
  useEffect(() => client.subscribeToConnectionState(setState), [client]);
  return state;
}
