import { tokens as t } from './tokens';

export const appTheme = {
  token: {
    colorPrimary:t.brand.primary,colorInfo:t.info,colorSuccess:t.success,colorWarning:t.warning,colorError:t.error,
    colorBgLayout:t.background,colorBgContainer:t.surface,colorBgElevated:t.surface,
    colorFillAlter:t.surfaceSubtle,colorBorder:t.border,colorBorderSecondary:t.border,
    colorText:t.textPrimary,colorTextSecondary:t.textSecondary,colorTextDisabled:t.textDisabled,
    fontFamily:t.fontFamily,fontSize:t.type.body,fontSizeHeading1:t.type.page,fontSizeHeading2:t.type.section,
    fontSizeHeading3:t.type.card,fontWeightStrong:600,controlHeight:40,borderRadius:t.radius.control,
    borderRadiusLG:t.radius.card,boxShadow:t.shadow,boxShadowSecondary:t.shadow,
    controlItemBgActive:t.surfaceSelected,controlOutline:t.brand.accent,
    sizeUnit:4,
  },
  components: {
    Layout:{bodyBg:t.background,headerBg:t.surface,siderBg:t.brand.navigation,triggerBg:t.brand.navigation},
    Menu:{darkItemBg:t.brand.navigation,darkSubMenuItemBg:t.brand.navigation,darkItemColor:'#E0E6F1',
      darkItemSelectedBg:t.brand.accent,darkItemSelectedColor:t.brand.navigation,
      darkItemHoverBg:'#2B3B77',darkItemHoverColor:'#FFFFFF',itemHeight:44,itemBorderRadius:8},
    Button:{primaryShadow:'none',defaultShadow:'none',fontWeight:500},
    Card:{borderRadiusLG:t.radius.card,headerFontSize:t.type.card},
    Form:{labelFontSize:t.type.label},
  },
};
