# Dotti-specific R8 rules.
# Keep this file narrow so R8 can obfuscate and remove as much unused code as possible.
# Add a targeted rule here only when a release-only reflection or native-module issue
# is reproduced during testing.

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
