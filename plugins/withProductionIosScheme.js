const fs = require('fs');
const path = require('path');
const { withDangerousMod, withInfoPlist, withPodfileProperties } = require('expo/config-plugins');

module.exports = function withProductionIosScheme(config) {
  const productionConfig = withInfoPlist(config, (modConfig) => {
    const infoPlist = modConfig.modResults;
    const urlTypes = Array.isArray(infoPlist.CFBundleURLTypes)
      ? infoPlist.CFBundleURLTypes
      : [];

    infoPlist.CFBundleURLTypes = urlTypes
      .map((urlType) => ({
        ...urlType,
        CFBundleURLSchemes: Array.isArray(urlType.CFBundleURLSchemes)
          ? urlType.CFBundleURLSchemes.filter((scheme) => !scheme.startsWith('exp+'))
          : [],
      }))
      .filter((urlType) => urlType.CFBundleURLSchemes.length > 0);

    infoPlist.NSAppTransportSecurity = {
      ...(infoPlist.NSAppTransportSecurity || {}),
      NSAllowsArbitraryLoads: false,
      NSAllowsLocalNetworking: false,
    };
    delete infoPlist.NSBonjourServices;
    delete infoPlist.NSLocalNetworkUsageDescription;

    return modConfig;
  });

  // Keep React Native and Expo modules on the same linkage strategy. Mixing
  // source-built React with precompiled Expo frameworks aborts at launch with
  // 'Library not loaded: @rpath/React.framework/React'.
  const sourceBuildConfig = withPodfileProperties(productionConfig, (modConfig) => {
    modConfig.modResults['ios.buildReactNativeFromSource'] = 'true';
    modConfig.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false';
    return modConfig;
  });

  return withDangerousMod(sourceBuildConfig, [
    'ios',
    async (modConfig) => {
      const projectName = modConfig.modRequest.projectName;
      const schemePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        'xcshareddata',
        'xcschemes',
        `${projectName}.xcscheme`,
      );

      if (!fs.existsSync(schemePath)) {
        throw new Error(`Le scheme iOS est introuvable : ${schemePath}`);
      }

      const source = fs.readFileSync(schemePath, 'utf8');
      const launchActionPattern = /<LaunchAction\b[\s\S]*?<\/LaunchAction>/;
      const launchAction = source.match(launchActionPattern)?.[0];

      if (!launchAction) {
        throw new Error(`L'action Run est introuvable dans : ${schemePath}`);
      }

      const openingTag = launchAction.match(/<LaunchAction\b[^>]*>/)?.[0];
      if (!openingTag) {
        throw new Error(`L'action Run est invalide dans : ${schemePath}`);
      }

      let productionTag = openingTag.replace(
        /buildConfiguration\s*=\s*"[^"]*"/,
        'buildConfiguration = "Release"',
      );

      if (/queueDebuggingEnabled\s*=/.test(productionTag)) {
        productionTag = productionTag.replace(
          /queueDebuggingEnabled\s*=\s*"[^"]*"/,
          'queueDebuggingEnabled = "NO"',
        );
      } else {
        productionTag = productionTag.replace(
          />$/,
          '\n      queueDebuggingEnabled = "NO">',
        );
      }

      const updatedLaunchAction = launchAction.replace(openingTag, productionTag);
      const updatedSource = source.replace(launchAction, updatedLaunchAction);

      if (updatedSource !== source) {
        fs.writeFileSync(schemePath, updatedSource);
      }

      const appDelegatePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        projectName,
        'AppDelegate.swift',
      );
      if (fs.existsSync(appDelegatePath)) {
        const appDelegate = fs.readFileSync(appDelegatePath, 'utf8');
        const updatedAppDelegate = appDelegate.replace(
          '    // needed to return the correct URL for expo-dev-client.\n',
          '',
        );
        if (updatedAppDelegate !== appDelegate) {
          fs.writeFileSync(appDelegatePath, updatedAppDelegate);
        }
      }

      return modConfig;
    },
  ]);
};
