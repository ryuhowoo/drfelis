import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// 각 테스트 후 DOM 정리 (globals 미사용이라 수동 등록)
afterEach(() => cleanup());
