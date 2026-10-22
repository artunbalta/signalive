import { test } from "@playwright/test";
import { cameraLaunch, headTurnTest } from "./focus-camera";

test.use({ launchOptions: cameraLaunch("right") });
headTurnTest("right");
