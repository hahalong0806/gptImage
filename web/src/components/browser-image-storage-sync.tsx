"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";

import { fetchImageStorageConfig } from "@/lib/api";
import { getStoredAuthKey } from "@/store/auth";
import { pruneExpiredBrowserManagedImages, syncBrowserImageClearSignal } from "@/store/browser-managed-images";

const POLL_INTERVAL_MS = 30_000;

export function BrowserImageStorageSync() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/login") {
      return;
    }

    let active = true;

    const check = async () => {
      const authKey = await getStoredAuthKey();
      if (!active || !authKey) {
        return;
      }
      try {
        const data = await fetchImageStorageConfig();
        if (!active) {
          return;
        }
        const result = await syncBrowserImageClearSignal(String(data.image_storage.browser_clear_token || ""));
        if (result.applied) {
          toast.success(result.removed > 0 ? `管理员已清空浏览器图片，本地同步清除了 ${result.removed} 张` : "管理员已发起浏览器图片清空，本地已同步");
        }
        if (data.image_storage.mode === "browser" && Number(data.image_storage.image_retention_days) > 0) {
          await pruneExpiredBrowserManagedImages(Number(data.image_storage.image_retention_days));
        }
      } catch {
        // Ignore polling failures; page-level auth handling will cover invalid sessions.
      }
    };

    void check();
    const timer = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  return null;
}
