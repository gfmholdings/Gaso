#!/usr/bin/env ruby
# Patch signing settings in the generated ios/*.xcodeproj for manual signing
# with the App Store provisioning profile created in the Apple portal.
# Run AFTER `expo prebuild` (which generates the ios/ project).
require 'xcodeproj'

TEAM_ID = '8H56KM6SCW'
PROFILES = { 'Gaso' => 'Gaso App Store' }.freeze

project_path = Dir['ios/*.xcodeproj'].first
abort 'ERROR: no .xcodeproj found under ios/ — did prebuild run?' unless project_path

project = Xcodeproj::Project.open(project_path)
puts "Project targets: #{project.targets.map(&:name).join(', ')}"

BUILD_NUMBER = ENV['BUILD_NUMBER']
abort 'ERROR: BUILD_NUMBER env not set' if BUILD_NUMBER.nil? || BUILD_NUMBER.empty?

found = []
project.targets.each do |target|
  specifier = PROFILES[target.name]
  next unless specifier

  found << target.name
  target.build_configurations.each do |config|
    settings = config.build_settings
    settings['CURRENT_PROJECT_VERSION'] = BUILD_NUMBER
    settings['CODE_SIGN_STYLE'] = 'Manual'
    settings['DEVELOPMENT_TEAM'] = TEAM_ID
    settings['PROVISIONING_PROFILE_SPECIFIER'] = specifier
    settings.delete('PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]')
    settings.delete('PROVISIONING_PROFILE[sdk=iphoneos*]')
    next unless config.name == 'Release'

    settings['CODE_SIGN_IDENTITY'] = 'Apple Distribution'
    settings.delete('CODE_SIGN_IDENTITY[sdk=iphoneos*]')
  end
  puts "Patched #{target.name} -> #{specifier}"
end

missing = PROFILES.keys - found
abort "ERROR: targets not found in project: #{missing.join(', ')}" unless missing.empty?

app_target = project.targets.find do |t|
  t.product_type == 'com.apple.product-type.application'
end
abort 'ERROR: no application target found in project' unless app_target
plist_rel = app_target.build_configurations.first
                        .build_settings['INFOPLIST_FILE']
if plist_rel.nil? || plist_rel.empty?
  abort 'ERROR: app target has no INFOPLIST_FILE build setting'
end
plist_path = File.join(File.dirname(project_path), plist_rel)
abort "ERROR: app Info.plist not found at #{plist_path}" unless File.exist?(plist_path)
plist = File.read(plist_path)
matched = plist.sub!(
  /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/
) { "#{Regexp.last_match(1)}#{BUILD_NUMBER}#{Regexp.last_match(2)}" }
abort "ERROR: no CFBundleVersion entry found in #{plist_path}" unless matched
File.write(plist_path, plist)
puts "Patched #{plist_rel} CFBundleVersion -> #{BUILD_NUMBER}"

project.save
puts 'Signing patch applied.'
