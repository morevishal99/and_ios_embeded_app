#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreLocation/CoreLocation.h>

@interface AppDelegate () <CLLocationManagerDelegate>
@end

@implementation AppDelegate {
  UITextField *_secureField;
  UIView *_privacyShield;
  CLLocationManager *_locationManager;
}

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"MarkOne";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  BOOL success = [super application:application didFinishLaunchingWithOptions:launchOptions];

  [self enableSecureScreen];
  [self setupAppSwitcherProtection];

  return success;
}

- (UIInterfaceOrientationMask)application:(UIApplication *)application supportedInterfaceOrientationsForWindow:(UIWindow *)window
{
  return UIInterfaceOrientationMaskPortrait;
}

- (void)setupAppSwitcherProtection
{
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleAppResignActive)
                                               name:UIApplicationWillResignActiveNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleAppBecomeActive)
                                               name:UIApplicationDidBecomeActiveNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleScreenCaptureChanged)
                                               name:UIScreenCapturedDidChangeNotification
                                             object:nil];
}

- (void)handleScreenCaptureChanged
{
  dispatch_async(dispatch_get_main_queue(), ^{
    if ([UIScreen mainScreen].isCaptured) {
      [self handleAppResignActive];
    } else {
      [self handleAppBecomeActive];
    }
  });
}

- (void)handleAppResignActive
{
  UIWindow *window = self.window;
  if (!window) {
    window = [UIApplication sharedApplication].keyWindow;
  }
  if (!window) return;

  if (!_privacyShield) {
    _privacyShield = [[UIView alloc] initWithFrame:window.bounds];
    _privacyShield.backgroundColor = [UIColor blackColor];
    _privacyShield.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  }
  _privacyShield.alpha = 1.0;
  [window addSubview:_privacyShield];
  [window bringSubviewToFront:_privacyShield];
}

- (void)handleAppBecomeActive
{
  if (_privacyShield && _privacyShield.superview) {
    [UIView animateWithDuration:0.15 animations:^{
      self->_privacyShield.alpha = 0.0;
    } completion:^(BOOL finished) {
      [self->_privacyShield removeFromSuperview];
      self->_privacyShield = nil;
    }];
  }
}

- (void)enableSecureScreen
{
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = self.window;
    if (!window) {
      window = [UIApplication sharedApplication].keyWindow;
    }
    if (!window) return;

    if (!self->_secureField) {
      CGRect screenBounds = [UIScreen mainScreen].bounds;
      self->_secureField = [[UITextField alloc] initWithFrame:screenBounds];
      self->_secureField.userInteractionEnabled = NO;
      self->_secureField.secureTextEntry = YES;
      self->_secureField.backgroundColor = [UIColor clearColor];

      if (window.layer.superlayer) {
        [window.layer.superlayer addSublayer:self->_secureField.layer];
      } else {
        [window addSubview:self->_secureField];
      }

      if (self->_secureField.layer.sublayers.count > 0) {
        [self->_secureField.layer.sublayers.firstObject addSublayer:window.layer];
      }
    }
  });
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self getBundleURL];
}

- (NSURL *)getBundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
