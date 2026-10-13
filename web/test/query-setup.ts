import { notifyManager } from "@tanstack/react-query";

notifyManager.setScheduler(queueMicrotask);

import { afterEach, beforeEach } from "vitest";
import { queryClient } from "../src/shared/api/query-client.js";

beforeEach(() => queryClient.clear());
afterEach(() => queryClient.clear());
