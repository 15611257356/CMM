export type DetectedCircle = {
  id: string
  px: number
  py: number
  radiusPx: number
  x: number
  y: number
  z: number
  radius: number
}

export type VisionCalibration = {
  imageWidth: number
  imageHeight: number
  padX: number
  padY: number
}

export interface CameraDriver {
  isConnected(): boolean
  grabFrame(): Promise<ImageData>
}
