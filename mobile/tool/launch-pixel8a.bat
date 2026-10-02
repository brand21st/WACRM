@echo off
set ANDROID_HOME=C:\Android\Sdk
set ANDROID_SDK_ROOT=C:\Android\Sdk
set ANDROID_AVD_HOME=C:\Android\avd
cd /d C:\Android\Sdk\emulator
start "Pixel 8a" emulator.exe -avd Pixel_8a -no-snapshot-load -gpu software
