import { useMediaQuery } from 'react-responsive';

const useIsMobile = () => {
  return useMediaQuery({ maxWidth: 767 }); // <768px = Mobile
};

export default useIsMobile;
