import { Suite } from "@playwright/test/reporter";
import { MsTeamsReporterOptions } from ".";
import {
  createTableRow,
  getFailedTests,
  getMentions,
  getNotificationBackground,
  getNotificationColor,
  getNotificationTitle,
  getTotalStatus,
  validateWebhookUrl,
} from "./utils";
import { BaseAdaptiveCard, BaseTable } from "./constants";
import fetch from 'node-fetch'
import { HttpsProxyAgent } from 'https-proxy-agent'

export const processResults = async (
  suite: Suite | undefined,
  options: MsTeamsReporterOptions
) => {
  if (!options.webhookUrl) {
    console.error("No webhook URL provided");
    return;
  }

  if (!validateWebhookUrl(options.webhookUrl, options.webhookType)) {
    console.error("Invalid webhook URL");
    return;
  }

  if (!suite) {
    console.error("No test suite found");
    return;
  }

  if (options.shouldRun && !options?.shouldRun(suite)) return

  // Clone the base adaptive card and table
  const adaptiveCard = structuredClone(BaseAdaptiveCard);
  const table = structuredClone(BaseTable);

  const totalStatus = getTotalStatus(suite.suites);
  const failedTests = getFailedTests(suite.suites);
  const totalTests = suite.allTests().length;
  const isSuccess = totalStatus.failed === 0;

  if (isSuccess && !options.notifyOnSuccess) {
    if (!options.quiet) {
      console.log("No failed tests, skipping notification");
    }
    return;
  }

  table.rows.push(createTableRow("Type", "Total"));

  table.rows.push(
    createTableRow(
      `${options.enableEmoji ? "✅ " : ""}Passed`,
      totalStatus.passed,
      { style: "good" }
    )
  );
  if (totalStatus.flaky) {
    table.rows.push(
      createTableRow(
        `${options.enableEmoji ? "⚠️ " : ""}Flaky`,
        totalStatus.flaky,
        { style: "warning" }
      )
    );
  }
  table.rows.push(
    createTableRow(
      `${options.enableEmoji ? "❌ " : ""}Failed`,
      totalStatus.failed,
      { style: "attention" }
    )
  );
  if (failedTests.length > 20) {
    table.rows.push(
      createTableRow("Failed more than 20 tests, see Jenkins pipeline for further details",
        '',
        { style: "attention" }
      )
    );
  } else {
    for (const failedTest of failedTests) {
      table.rows.push(
        createTableRow(failedTest,
          '',
          { style: "attention" }
        )
      );
    }
  }


  table.rows.push(
    createTableRow(
      `${options.enableEmoji ? "⏭️ " : ""}Skipped`,
      totalStatus.skipped,
      { style: "accent" }
    )
  );
  table.rows.push(
    createTableRow("Total tests", totalTests, {
      isSubtle: true,
      weight: "Bolder",
    })
  );

  const container = {
    type: "Container",
    items: [
      {
        type: "TextBlock",
        size: "ExtraLarge",
        weight: "Bolder",
        text: options.title,
      },
      {
        type: "TextBlock",
        size: "Large",
        weight: "Bolder",
        text: getNotificationTitle(totalStatus),
        color: getNotificationColor(totalStatus),
      },
      table,
    ] as any[],
    bleed: true,
    backgroundImage: {
      url: getNotificationBackground(totalStatus),
      fillMode: "RepeatHorizontally",
    },
  };

  // Check if we should ping on failure
  if (!isSuccess) {
    const mentionData = getMentions(
      options.mentionOnFailure,
      options.mentionOnFailureText
    );
    if (mentionData?.message && mentionData.mentions.length > 0) {
      container.items.push({
        type: "TextBlock",
        size: "Medium",
        text: mentionData.message,
        wrap: true,
      });

      adaptiveCard.msteams.entities = mentionData.mentions.map((mention) => ({
        type: "mention",
        text: `<at>${mention.email}</at>`,
        mentioned: {
          id: mention.email,
          name: mention.name,
        },
      }));
    }
  }

  // Add the container to the body
  adaptiveCard.body.push(container);

  // Get the github actions run URL
  if (options.linkToResultsUrl) {
    let linkToResultsUrl: string;
    if (typeof options.linkToResultsUrl === "string") {
      linkToResultsUrl = options.linkToResultsUrl;
    } else {
      linkToResultsUrl = options.linkToResultsUrl();
    }

    if (linkToResultsUrl && typeof linkToResultsUrl === "string") {
      adaptiveCard.actions.push({
        type: "Action.OpenUrl",
        title: options.linkToResultsText,
        url: linkToResultsUrl,
      });
    }
  }

  if (!isSuccess && options.linkTextOnFailure && options.linkUrlOnFailure) {
    let linkUrlOnFailure: string;
    if (typeof options.linkUrlOnFailure === "string") {
      linkUrlOnFailure = options.linkUrlOnFailure;
    } else {
      linkUrlOnFailure = options.linkUrlOnFailure();
    }

    if (linkUrlOnFailure && typeof linkUrlOnFailure === "string") {
      adaptiveCard.actions.push({
        type: "Action.OpenUrl",
        title: options.linkTextOnFailure,
        url: linkUrlOnFailure,
      });
    }
  }

  if (options.webhookType === "powerautomate") {
    adaptiveCard.version = "1.4";
  }

  const body = JSON.stringify({
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: adaptiveCard,
      },
    ],
  });

  if (options.debug) {
    console.log("Sending the following message:");
    console.log(body);
  }

  const agent = new HttpsProxyAgent('http://enc-proxy-mi.enc.local:8080');

  const response = await fetch(options.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    agent,
  });

  if (response.ok) {
    if (!options.quiet) {
      console.log("Message sent successfully");
      const responseText = await response.text();
      if (responseText !== "1") {
        console.log(responseText);
      }
    }
  } else {
    console.error("Failed to send message");
    console.error(await response.text());
  }
};
