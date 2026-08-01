import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { CaregiverPage } from "./pages/CaregiverPage";
import { DemoControlPage } from "./pages/DemoControlPage";
import { DocsPage } from "./pages/DocsPage";
import { ElderDashboardPage } from "./pages/ElderDashboardPage";
import { ElderProfilePage } from "./pages/ElderProfilePage";
import { ConsentPrivacyPage } from "./pages/ConsentPrivacyPage";
import { FamilyPage } from "./pages/FamilyPage";
import { InstitutionPage } from "./pages/InstitutionPage";
import { MedicationPage } from "./pages/MedicationPage";
import { MemoryIntakePage } from "./pages/MemoryIntakePage";
import { ElderVoiceCompanionPage } from "./pages/ElderVoiceCompanionPage";
import { WearableImportPage } from "./pages/WearableImportPage";

const getCurrentPath = () => {
  const path = window.location.hash.replace(/^#/, "");
  return path || "/institution";
};

export const renderRoute = (path: string) => {
  if (path === "/institution") return <InstitutionPage />;
  if (path === "/caregiver") return <CaregiverPage />;
  const wearableImportMatch = path.match(/^\/elder\/([^/]+)\/wearable-import$/);
  if (wearableImportMatch) {
    return <WearableImportPage elderId={wearableImportMatch[1]} />;
  }
  const memoryIntakeMatch = path.match(/^\/elder\/([^/]+)\/memory-intake$/);
  if (memoryIntakeMatch) {
    return <MemoryIntakePage key={memoryIntakeMatch[1]} elderId={memoryIntakeMatch[1]} />;
  }
  const voiceCompanionMatch = path.match(/^\/elder\/([^/]+)\/voice$/);
  if (voiceCompanionMatch) {
    return <ElderVoiceCompanionPage key={voiceCompanionMatch[1]} elderId={voiceCompanionMatch[1]} />;
  }
  const caregiverPrivacyMatch = path.match(/^\/caregiver\/elder\/([^/]+)\/privacy$/);
  if (caregiverPrivacyMatch) {
    return <ConsentPrivacyPage key={caregiverPrivacyMatch[1]} elderId={caregiverPrivacyMatch[1]} viewerRole="caregiver" />;
  }
  const privacyMatch = path.match(/^\/elder\/([^/]+)\/privacy$/);
  if (privacyMatch) {
    return <ConsentPrivacyPage key={privacyMatch[1]} elderId={privacyMatch[1]} viewerRole="elder" />;
  }
  const familyPrivacyMatch = path.match(/^\/family\/([^/]+)\/privacy$/);
  if (familyPrivacyMatch) {
    return <ConsentPrivacyPage key={familyPrivacyMatch[1]} elderId={familyPrivacyMatch[1]} viewerRole="family" />;
  }
  if (path.startsWith("/elder/") && path.endsWith("/profile")) {
    return <ElderProfilePage elderId={path.split("/")[2] || "E001"} />;
  }
  if (path.startsWith("/elder/")) {
    return <ElderDashboardPage elderId={path.split("/")[2] || "E001"} />;
  }
  if (path.startsWith("/medication/")) {
    return <MedicationPage elderId={path.split("/")[2] || "E001"} />;
  }
  if (path.startsWith("/family/")) {
    return <FamilyPage elderId={path.split("/")[2] || "E001"} />;
  }
  if (path === "/demo-control") return <DemoControlPage />;
  if (path === "/docs") return <DocsPage />;
  return <InstitutionPage />;
};

export const App = () => {
  const [path, setPath] = useState(getCurrentPath);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "#/institution";
    }
    const handleHashChange = () => setPath(getCurrentPath());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return <AppShell currentPath={path}>{renderRoute(path)}</AppShell>;
};
