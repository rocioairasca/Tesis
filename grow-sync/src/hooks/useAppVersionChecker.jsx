import { useEffect, useRef } from "react";
import { Button, notification } from "antd";

import {
    APP_VERSION,
    SHOULD_CHECK_APP_VERSION,
} from "../config/appVersion";

const CHECK_INTERVAL_MS = 12 * 60 * 1000;
const UPDATE_NOTIFICATION_KEY = "growsync-app-update";

const fetchServerVersion = async () => {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
        cache: "no-store",
    });

    if (!response.ok) {
        return null;
    }

    const data = await response.json();
    return typeof data?.version === "string" ? data.version : null;
};

const reloadApp = () => {
    window.location.reload();
};

const showUpdateNotification = () => {
    notification.open({
        key: UPDATE_NOTIFICATION_KEY,
        message: "Hay una nueva versión de GrowSync disponible.",
        description: "Actualizá la aplicación para usar la última versión.",
        btn: (
            <Button type="primary" onClick={reloadApp}>
                Actualizar ahora
            </Button>
        ),
        duration: 0,
        placement: "topRight",
    });
};

export const useAppVersionChecker = () => {
    const hasNotifiedRef = useRef(false);
    const isCheckingRef = useRef(false);

    useEffect(() => {
        if (!SHOULD_CHECK_APP_VERSION) {
            return undefined;
        }

        const checkVersion = async () => {
            if (isCheckingRef.current || hasNotifiedRef.current) {
                return;
            }

            isCheckingRef.current = true;

            try {
                const serverVersion = await fetchServerVersion();

                if (serverVersion && serverVersion !== APP_VERSION) {
                    hasNotifiedRef.current = true;
                    showUpdateNotification();
                }
            } catch {
                // Si falla la consulta, no interrumpimos al usuario.
            } finally {
                isCheckingRef.current = false;
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                checkVersion();
            }
        };

        checkVersion();

        document.addEventListener(
            "visibilitychange",
            handleVisibilityChange
        );

        const intervalId = window.setInterval(
            checkVersion,
            CHECK_INTERVAL_MS
        );

        return () => {
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );
            window.clearInterval(intervalId);
        };
    }, []);
};
