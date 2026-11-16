"use client";

import { Suspense } from "react";
import { REFERENCE_PATTERN } from "@/lib/rwa";
import { RwaApply, RwaOffering, RwaOfferings } from "./RwaExplorer";
import IssuerWorkspace from "./IssuerWorkspace";
import AccountExperience, { VerifyAccount } from "./AccountExperience";

/** Routes /rwa, /rwa/apply, /rwa/<ref>, /rwa/applications/<ref>, /account, /account/verify. */
export default function RwaExperience({ pathname }: { pathname: string }) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "account") return parts[1] === "verify" ? <Suspense><VerifyAccount/></Suspense> : <AccountExperience/>;
  if (parts[1] === "apply") return <RwaApply/>;
  if (parts[1] === "applications" && parts[2] && REFERENCE_PATTERN.test(parts[2])) return <IssuerWorkspace reference={parts[2]}/>;
  if (parts[1] && REFERENCE_PATTERN.test(parts[1])) return <RwaOffering reference={parts[1]}/>;
  return <RwaOfferings/>;
}
