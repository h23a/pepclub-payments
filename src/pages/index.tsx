import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { NextPage } from "next";
import { useMemo } from "react";

import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { PublicHomePage } from "@/components/public/home-page";

const IndexPage: NextPage = () => {
  const { appBridgeState } = useAppBridge();
  const showDashboard = useMemo(
    () => Boolean(appBridgeState?.ready && appBridgeState.saleorApiUrl && appBridgeState.token),
    [appBridgeState?.ready, appBridgeState?.saleorApiUrl, appBridgeState?.token]
  );

  return showDashboard ? <DashboardPage /> : <PublicHomePage />;
};

export default IndexPage;
