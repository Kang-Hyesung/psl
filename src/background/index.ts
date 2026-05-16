import { createHideListSyncBackgroundService } from './hide-list-sync-service';
import { createChromeStorageLocalDriver, LocalStorageRepository } from '../storage';

if (typeof chrome !== 'undefined' && chrome.runtime) {
  const repository = new LocalStorageRepository(createChromeStorageLocalDriver());
  const backgroundService = createHideListSyncBackgroundService({
    runtime: chrome.runtime,
    repository
  });

  backgroundService.start();
  chrome.runtime.onInstalled.addListener(() => {});
}
