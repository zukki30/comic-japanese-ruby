chrome.action.onClicked.addListener(async (tab) => {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      tab.windowId,
      { format: "png" }
    );

    await chrome.downloads.download({
      url: dataUrl,
      filename: "kindle-capture-test.png",
      saveAs: true
    });

    console.log("キャプチャ成功");
  } catch (error) {
    console.error("キャプチャ失敗:", error);
  }
});
