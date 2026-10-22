import { test } from "@playwright/test";
import { cameraLaunch, headTurnTest } from "./focus-camera";

test.use({ launchOptions: cameraLaunch("left") });
headTurnTest("left");
