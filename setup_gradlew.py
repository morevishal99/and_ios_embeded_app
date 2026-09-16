import os

android_dir = r'c:\Auxilo\MarkOne\android'
wrapper_dir = os.path.join(android_dir, 'gradle', 'wrapper')
os.makedirs(wrapper_dir, exist_ok=True)

# 1. gradle-wrapper.properties
props = """distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
"""
with open(os.path.join(wrapper_dir, 'gradle-wrapper.properties'), 'w') as f:
    f.write(props)

# 2. gradlew.bat
gradlew_bat = r"""@rem
@rem Copyright 2015 the original author or authors.
@rem
@if "%DEBUG%" == "" @echo off
@if "%OS%"=="Windows_NT" setlocal

set DIRNAME=%~dp0
if "%DIRNAME%" == "" set DIRNAME=.
set DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"

@rem Find java.exe
if defined JAVA_HOME goto findJavaFromJavaHome

set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if "%ERRORLEVEL%" == "0" goto execute

echo.
echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
goto fail

:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%/bin/java.exe

if exist "%JAVA_EXE%" goto execute

echo.
echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
goto fail

:execute
set CLASSPATH=%DIRNAME%gradle/wrapper/gradle-wrapper.jar
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*

:end
@if "%OS%" == "Windows_NT" rem

:fail
exit /b 1
"""
with open(os.path.join(android_dir, 'gradlew.bat'), 'w') as f:
    f.write(gradlew_bat)

print("Updated gradlew.bat and gradle-wrapper.properties for Gradle 8.5")
