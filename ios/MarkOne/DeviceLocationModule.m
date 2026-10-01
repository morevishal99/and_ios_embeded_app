#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <CoreLocation/CoreLocation.h>
#import <AVFoundation/AVFoundation.h>

@interface DeviceLocationModule : NSObject <RCTBridgeModule, CLLocationManagerDelegate>
@property (nonatomic, strong) CLLocationManager *locationManager;
@property (nonatomic, copy) RCTPromiseResolveBlock permResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock permReject;
@property (nonatomic, copy) RCTPromiseResolveBlock locResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock locReject;
@end

@implementation DeviceLocationModule

RCT_EXPORT_MODULE(DeviceLocationModule);

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if (self = [super init]) {
    _locationManager = [[CLLocationManager alloc] init];
    _locationManager.delegate = self;
    _locationManager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters;
  }
  return self;
}

RCT_EXPORT_METHOD(checkLocationPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CLAuthorizationStatus status;
  if (@available(iOS 14.0, *)) {
    status = self.locationManager.authorizationStatus;
  } else {
    status = [CLLocationManager authorizationStatus];
  }
  
  BOOL granted = (status == kCLAuthorizationStatusAuthorizedWhenInUse ||
                  status == kCLAuthorizationStatusAuthorizedAlways);
  resolve(@(granted));
}

RCT_EXPORT_METHOD(checkCameraPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  resolve(@(status == AVAuthorizationStatusAuthorized));
}

RCT_EXPORT_METHOD(requestCameraPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
  if (status == AVAuthorizationStatusAuthorized) {
    resolve(@(YES));
  } else if (status == AVAuthorizationStatusNotDetermined) {
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(@(granted));
      });
    }];
  } else {
    resolve(@(NO));
  }
}

RCT_EXPORT_METHOD(checkMicrophonePermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSessionRecordPermission status = [[AVAudioSession sharedInstance] recordPermission];
  resolve(@(status == AVAudioSessionRecordPermissionGranted));
}

RCT_EXPORT_METHOD(requestMicrophonePermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioSessionRecordPermission status = [[AVAudioSession sharedInstance] recordPermission];
  if (status == AVAudioSessionRecordPermissionGranted) {
    resolve(@(YES));
  } else if (status == AVAudioSessionRecordPermissionUndetermined) {
    [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(@(granted));
      });
    }];
  } else {
    resolve(@(NO));
  }
}

RCT_EXPORT_METHOD(requestLocationPermission:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CLAuthorizationStatus status;
  if (@available(iOS 14.0, *)) {
    status = self.locationManager.authorizationStatus;
  } else {
    status = [CLLocationManager authorizationStatus];
  }

  if (status == kCLAuthorizationStatusAuthorizedWhenInUse ||
      status == kCLAuthorizationStatusAuthorizedAlways) {
    resolve(@(YES));
    return;
  }

  if (status == kCLAuthorizationStatusDenied ||
      status == kCLAuthorizationStatusRestricted) {
    resolve(@(NO));
    return;
  }

  // kCLAuthorizationStatusNotDetermined -> triggers the native hardware iOS dialog!
  self.permResolve = resolve;
  self.permReject = reject;
  [self.locationManager requestWhenInUseAuthorization];
}

RCT_EXPORT_METHOD(getLatestLocation:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  CLAuthorizationStatus status;
  if (@available(iOS 14.0, *)) {
    status = self.locationManager.authorizationStatus;
  } else {
    status = [CLLocationManager authorizationStatus];
  }

  if (status != kCLAuthorizationStatusAuthorizedWhenInUse &&
      status != kCLAuthorizationStatusAuthorizedAlways) {
    resolve([NSNull null]);
    return;
  }

  CLLocation *loc = self.locationManager.location;
  if (loc != nil &&
      CLLocationCoordinate2DIsValid(loc.coordinate) &&
      fabs(loc.coordinate.latitude) > 0.0001 &&
      fabs(loc.coordinate.longitude) > 0.0001) {
    resolve(@{
      @"latitude": @(loc.coordinate.latitude),
      @"longitude": @(loc.coordinate.longitude),
      @"accuracy": @(loc.horizontalAccuracy),
      @"time": @([loc.timestamp timeIntervalSince1970] * 1000.0)
    });
    return;
  }

  self.locResolve = resolve;
  self.locReject = reject;
  [self.locationManager requestLocation];
}

#pragma mark - CLLocationManagerDelegate

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager
{
  CLAuthorizationStatus status;
  if (@available(iOS 14.0, *)) {
    status = manager.authorizationStatus;
  } else {
    status = [CLLocationManager authorizationStatus];
  }

  if (status == kCLAuthorizationStatusNotDetermined) {
    return;
  }

  if (self.permResolve != nil) {
    BOOL granted = (status == kCLAuthorizationStatusAuthorizedWhenInUse ||
                    status == kCLAuthorizationStatusAuthorizedAlways);
    RCTPromiseResolveBlock resolver = self.permResolve;
    self.permResolve = nil;
    self.permReject = nil;
    resolver(@(granted));
  }
}

- (void)locationManager:(CLLocationManager *)manager didChangeAuthorizationStatus:(CLAuthorizationStatus)status
{
  if (status == kCLAuthorizationStatusNotDetermined) {
    return;
  }

  if (self.permResolve != nil) {
    BOOL granted = (status == kCLAuthorizationStatusAuthorizedWhenInUse ||
                    status == kCLAuthorizationStatusAuthorizedAlways);
    RCTPromiseResolveBlock resolver = self.permResolve;
    self.permResolve = nil;
    self.permReject = nil;
    resolver(@(granted));
  }
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations
{
  CLLocation *loc = [locations lastObject];
  if (self.locResolve != nil && loc != nil) {
    RCTPromiseResolveBlock resolver = self.locResolve;
    self.locResolve = nil;
    self.locReject = nil;
    resolver(@{
      @"latitude": @(loc.coordinate.latitude),
      @"longitude": @(loc.coordinate.longitude),
      @"accuracy": @(loc.horizontalAccuracy),
      @"time": @([loc.timestamp timeIntervalSince1970] * 1000.0)
    });
  }
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error
{
  if (self.locResolve != nil) {
    RCTPromiseResolveBlock resolver = self.locResolve;
    self.locResolve = nil;
    self.locReject = nil;
    resolver([NSNull null]);
  }
}

@end
