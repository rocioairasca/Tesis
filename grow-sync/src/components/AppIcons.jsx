import { HouseIcon as PhHouse } from '@phosphor-icons/react/dist/csr/House';
import { CalendarDotsIcon as PhCalendarDots } from '@phosphor-icons/react/dist/csr/CalendarDots';
import { MapPinIcon as PhMapPin } from '@phosphor-icons/react/dist/csr/MapPin';
import { PackageIcon as PhPackage } from '@phosphor-icons/react/dist/csr/Package';
import { ChartBarIcon as PhChartBar } from '@phosphor-icons/react/dist/csr/ChartBar';
import { TractorIcon as PhTractor } from '@phosphor-icons/react/dist/csr/Tractor';
import { UsersIcon as PhUsers } from '@phosphor-icons/react/dist/csr/Users';
import { BellIcon as PhBell } from '@phosphor-icons/react/dist/csr/Bell';
import { GearIcon as PhGear } from '@phosphor-icons/react/dist/csr/Gear';
import { CloudIcon as PhCloud } from '@phosphor-icons/react/dist/csr/Cloud';
import { SunIcon as PhSun } from '@phosphor-icons/react/dist/csr/Sun';
import { CloudSunIcon as PhCloudSun } from '@phosphor-icons/react/dist/csr/CloudSun';
import { CloudMoonIcon as PhCloudMoon } from '@phosphor-icons/react/dist/csr/CloudMoon';
import { MoonIcon as PhMoon } from '@phosphor-icons/react/dist/csr/Moon';
import { CloudRainIcon as PhCloudRain } from '@phosphor-icons/react/dist/csr/CloudRain';
import { CloudLightningIcon as PhCloudLightning } from '@phosphor-icons/react/dist/csr/CloudLightning';
import { CloudSnowIcon as PhCloudSnow } from '@phosphor-icons/react/dist/csr/CloudSnow';
import { CloudFogIcon as PhCloudFog } from '@phosphor-icons/react/dist/csr/CloudFog';
import { WindIcon as PhWind } from '@phosphor-icons/react/dist/csr/Wind';
import { DropIcon as PhDrop } from '@phosphor-icons/react/dist/csr/Drop';
import { ThermometerIcon as PhThermometer } from '@phosphor-icons/react/dist/csr/Thermometer';
import { TornadoIcon as PhTornado } from '@phosphor-icons/react/dist/csr/Tornado';
import { WarningCircleIcon as PhWarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { PlantIcon as PhPlant } from '@phosphor-icons/react/dist/csr/Plant';
import { FlaskIcon as PhFlask } from '@phosphor-icons/react/dist/csr/Flask';
import { WrenchIcon as PhWrench } from '@phosphor-icons/react/dist/csr/Wrench';
import { DotsThreeIcon as PhDotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { StackIcon as PhStack } from '@phosphor-icons/react/dist/csr/Stack';
import { RulerIcon as PhRuler } from '@phosphor-icons/react/dist/csr/Ruler';
import { ClockIcon as PhClock } from '@phosphor-icons/react/dist/csr/Clock';
import { UserIcon as PhUser } from '@phosphor-icons/react/dist/csr/User';
import { ClipboardTextIcon as PhClipboardText } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { CaretLeftIcon as PhCaretLeft } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { SignOutIcon as PhSignOut } from '@phosphor-icons/react/dist/csr/SignOut';
import { TruckIcon as PhTruck } from '@phosphor-icons/react/dist/csr/Truck';
import { CarIcon as PhCar } from '@phosphor-icons/react/dist/csr/Car';
import { CubeIcon as PhCube } from '@phosphor-icons/react/dist/csr/Cube';
import { WarningIcon as PhWarning } from '@phosphor-icons/react/dist/csr/Warning';
import { ClockCountdownIcon as PhClockCountdown } from '@phosphor-icons/react/dist/csr/ClockCountdown';
import { XCircleIcon as PhXCircle } from '@phosphor-icons/react/dist/csr/XCircle';
import { WavesIcon as PhWaves } from '@phosphor-icons/react/dist/csr/Waves';
import React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert01Icon,
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  Calendar03Icon,
  CancelCircleIcon,
  Car03Icon,
  CheckmarkCircle02Icon,
  ClipboardIcon,
  Clock03Icon,
  CloudIcon,
  Copy01Icon,
  DashboardSquare03Icon,
  Delete02Icon,
  DeliveryBox02Icon,
  DollarCircleIcon,
  Edit02Icon,
  EyeIcon,
  File02Icon,
  FloppyDiskIcon,
  Home05Icon,
  InboxIcon,
  InformationCircleIcon,
  Leaf01Icon,
  Location06Icon,
  LockPasswordIcon,
  Mail01Icon,
  MapPinIcon,
  MoreHorizontalIcon,
  Notification03Icon,
  PackageIcon,
  PlusSignIcon,
  RulerIcon,
  StopCircleIcon,
  RefreshIcon,
  Target02Icon,
  TruckIcon,
  UserAdd01Icon,
  UserIcon,
  UserIdVerificationIcon,
  WheatIcon,
} from "@hugeicons/core-free-icons";

function normalizeSize(size, style, fallback = 18) {
  if (size != null) return size;
  const fontSize = style?.fontSize;
  if (typeof fontSize === "number") return fontSize;
  if (typeof fontSize === "string") {
    const parsed = Number.parseFloat(fontSize);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function createIcon(icon, fallbackSize = 18) {
  return function AppIcon({ size, style, strokeWidth = 1.8, ...props }) {
    return (
      <HugeiconsIcon
        icon={icon}
        size={normalizeSize(size, style, fallbackSize)}
        strokeWidth={strokeWidth}
        style={style}
        {...props}
      />
    );
  };
}

export const AimOutlined = createIcon(Target02Icon);
export const AlertOutlined = createIcon(Alert01Icon);
export const AppstoreOutlined = createIcon(DeliveryBox02Icon);
export const ArrowLeftOutlined = createIcon(ArrowLeft01Icon);
export const ArrowUpOutlined = createIcon(ArrowUp01Icon);
export const BellOutlined = createIcon(Notification03Icon);
export const Calendar = createIcon(Calendar03Icon);
export const CalendarOutlined = createIcon(Calendar03Icon);
export const CarOutlined = createIcon(Car03Icon);
export const CheckCircleOutlined = createIcon(CheckmarkCircle02Icon);
export const CheckOutlined = createIcon(CheckmarkCircle02Icon);
export const ClipboardText = createIcon(ClipboardIcon);
export const ClockCircleOutlined = createIcon(Clock03Icon);
export const CloseOutlined = createIcon(CancelCircleIcon);
export const CloudOutlined = createIcon(CloudIcon);
export const CopyOutlined = createIcon(Copy01Icon);
export const HarvestOutlined = createIcon(WheatIcon);
export const DashboardOutlined = createIcon(DashboardSquare03Icon);
export const DeleteOutlined = createIcon(Delete02Icon);
export const DollarOutlined = createIcon(DollarCircleIcon);
export const EditOutlined = createIcon(Edit02Icon);
export const EnvironmentOutlined = createIcon(Location06Icon);
export const ExclamationCircleOutlined = createIcon(AlertCircleIcon);
export const EyeOutlined = createIcon(EyeIcon);
export const FileTextOutlined = createIcon(File02Icon);
export const FormOutlined = createIcon(ClipboardIcon);
export const Gauge = createIcon(DashboardSquare03Icon);
export const HomeOutlined = createIcon(Home05Icon);
export const IdentificationCard = createIcon(UserIdVerificationIcon);
export const InboxOutlined = createIcon(InboxIcon);
export const InfoCircleOutlined = createIcon(InformationCircleIcon);
export const Leaf = createIcon(Leaf01Icon);
export const LeftOutlined = createIcon(ArrowLeft01Icon);
export const LockOutlined = createIcon(LockPasswordIcon);
export const LogoutOutlined = createIcon(ArrowLeft01Icon);
export const MailOutlined = createIcon(Mail01Icon);
export const MapPin = createIcon(MapPinIcon);
export const MinusCircleOutlined = createIcon(CancelCircleIcon);
export const MoreOutlined = createIcon(MoreHorizontalIcon);
export const Package = createIcon(PackageIcon);
export const PlusOutlined = createIcon(PlusSignIcon);
export const Ruler = createIcon(RulerIcon);
export const SaveOutlined = createIcon(FloppyDiskIcon);
export const StopOutlined = createIcon(StopCircleIcon);
export const SyncOutlined = createIcon(RefreshIcon);
export const Truck = createIcon(TruckIcon);
export const User = createIcon(UserIcon);
export const UserAddOutlined = createIcon(UserAdd01Icon);
export const UserOutlined = createIcon(UserIcon);

// Official family for redesigned surfaces. Legacy aliases above remain unchanged
// until their modules are migrated, avoiding a global visual refactor.
function phosphor(Icon, fallbackSize = 18) {
  return function DomainIcon({ size, style, weight = 'regular', strokeWidth, ...props }) {
    return <Icon size={normalizeSize(size, style, fallbackSize)} weight={weight} style={style} aria-hidden={props['aria-label'] ? undefined : true} {...props} />;
  };
}
export const AppIcons = {
  home:phosphor(PhHouse,20), planning:phosphor(PhCalendarDots,20), lots:phosphor(PhMapPin,20), inventory:phosphor(PhPackage,20),
  harvest:phosphor(PhChartBar,20), vehicle:phosphor(PhTractor,20), users:phosphor(PhUsers,20), notifications:phosphor(PhBell,20), settings:phosphor(PhGear,20),
  cloud:phosphor(PhCloud), sun:phosphor(PhSun), partlyCloudy:phosphor(PhCloudSun), cloudNight:phosphor(PhCloudMoon), moon:phosphor(PhMoon),
  rain:phosphor(PhCloudRain), storm:phosphor(PhCloudLightning), snow:phosphor(PhCloudSnow), fog:phosphor(PhCloudFog), wind:phosphor(PhWind), drop:phosphor(PhDrop),
  temperature:phosphor(PhThermometer), tornado:phosphor(PhTornado), warning:phosphor(PhWarning), alert:phosphor(PhWarningCircle),
  crop:phosphor(PhPlant), spray:phosphor(PhFlask), maintenance:phosphor(PhWrench), more:phosphor(PhDotsThree,20), divisions:phosphor(PhStack), area:phosphor(PhRuler),
  clock:phosphor(PhClock,16), person:phosphor(PhUser,16), usage:phosphor(PhClipboardText,20), collapse:phosphor(PhCaretLeft,20), logout:phosphor(PhSignOut),
  truck:phosphor(PhTruck), car:phosphor(PhCar), cube:phosphor(PhCube), expiring:phosphor(PhClockCountdown), unavailable:phosphor(PhXCircle), irrigation:phosphor(PhWaves),
};
export const activityIcons = { siembra:AppIcons.crop, fumigacion:AppIcons.spray, fertilizacion:AppIcons.spray, riego:AppIcons.irrigation, cosecha:AppIcons.vehicle, mantenimiento:AppIcons.maintenance, otro:AppIcons.more };
