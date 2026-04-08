import { useDashboardToken } from "@saleor/app-sdk/app-bridge";
import { NextPage } from "next";
import { useMemo } from "react";

import { DashboardPage } from "@/components/dashboard/dashboard-page";
import { PublicHomePage } from "@/components/public/home-page";

const IndexPage: NextPage = () => {
  const { hasAppToken, isTokenValid } = useDashboardToken();
  const showDashboard = useMemo(() => hasAppToken && isTokenValid, [hasAppToken, isTokenValid]);

  return showDashboard ? <DashboardPage /> : <PublicHomePage />;
};

export default IndexPage;
