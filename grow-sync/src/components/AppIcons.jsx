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
